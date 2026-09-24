// TWO-SESSION CONCURRENCY GATE — real PostgreSQL (embedded), two independent
// sessions per race. READ COMMITTED (verified default; set explicitly per tx).
// Loads the SHIPPED files byte-identical (pgcrypto exists here — zero shims).
// Rule under test (frozen §F/R7): conditional atomic reserve + deterministic locks.
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool, Client } = require('pg');
const fs = require('fs');
const path = require('path');
process.on('unhandledRejection', (e) => { console.log('UNHANDLED: ' + String((e && e.message) || e).split('\n')[0]); process.exit(1); });

const DBDIR = path.join(__dirname, '..'); // repo db/ dir
let seq = 100000;
const uid = () => '7f000000-0000-7000-8000-' + (seq++).toString(16).padStart(12, '0');
const now = () => Date.now();

// ---- tiny reusable barrier (entry gate + reservation-point latch) ----
function latch(n) {
  let count = 0, release;
  const ready = new Promise((res) => { release = res; });
  return {
    arrive: () => { if (++count === n) release(); return ready; },
  };
}
// Reservation-point latch helper: no-op when a scenario passes none.
const eventsBarrierRelease = (fn) => (typeof fn === 'function' ? fn() : Promise.resolve());

(async () => {
  const pg = new EmbeddedPostgres({ databaseDir: './pgdata-gate2', user: 'postgres', password: 'postgres', port: 55435, persistent: false });
  await pg.initialise();
  await pg.start();
  const pool0 = new Pool({ host: '127.0.0.1', port: 55435, user: 'postgres', password: 'postgres', database: 'postgres', max: 2 });
  const superClient = await pool0.connect();
  try {
    await superClient.query(`SELECT version()`).then(r => console.log('PG:', r.rows[0].version.split(' ').slice(0, 2).join(' ')));
    await superClient.query(`SHOW default_transaction_isolation`).then(r => console.log('isolation:', r.rows[0].default_transaction_isolation));
    // Server locale is WIN1256; shipped files are UTF8 by design (production uses UTF8).
    // Test env fix (not a file fix): run the gate in a UTF8 database.
    await superClient.query(`DROP DATABASE IF EXISTS gatedb`);
    await superClient.query(`CREATE DATABASE gatedb ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    console.log('gatedb (UTF8): OK');
  } finally { superClient.release(); }
  const pool = new Pool({ host: '127.0.0.1', port: 55435, user: 'postgres', password: 'postgres', database: 'gatedb', max: 6 });
  const admin = await pool.connect();
  try {
    for (const f of ['phase1-schema.sql', 'phase1-seed-example.sql', 'phase2-schema.sql'])
      await admin.query(fs.readFileSync(path.join(DBDIR, f), 'utf8'));
    console.log('shipped files loaded PRISTINE (no shims)');

    // ---- TEST fixtures: probe product + variants (labeled TEST-*) ----
    const CAT = '01800000-0000-7000-8000-000000000001';
    await admin.query(`INSERT INTO products (id, name, slug, category_id, product_type, unit)
      VALUES ('7f000000-0000-7000-8000-000000000001','TEST Probe Unit','test-probe-unit',$1,'PIECE','PIECE')`, [CAT]);
    await admin.query(`INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
      VALUES ('7f000000-0000-7000-8000-000000000002','7f000000-0000-7000-8000-000000000001','UNIT',1,'PIECE',10.00)`);
    await admin.query(`INSERT INTO products (id, name, slug, category_id, product_type, unit, sale_step_grams)
      VALUES ('7f000000-0000-7000-8000-000000000003','TEST Probe KG','test-probe-kg',$1,'WEIGHT','KG',100)`, [CAT]);
    await admin.query(`INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
      VALUES ('7f000000-0000-7000-8000-000000000004','7f000000-0000-7000-8000-000000000003','KG',1,'KG',100.00)`);
    await admin.query(`INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
      VALUES ('7f000000-0000-7000-8000-000000000005','7f000000-0000-7000-8000-000000000001','SUB',1,'PIECE',5.00)`);
    const VU = '7f000000-0000-7000-8000-000000000002';
    const VK = '7f000000-0000-7000-8000-000000000004';
    const VS = '7f000000-0000-7000-8000-000000000005';
    const resetInv = (v, q) => admin.query(
      `INSERT INTO inventory (product_variant_id, quantity) VALUES ($1,$2)
       ON CONFLICT (product_variant_id) DO UPDATE SET quantity=$2, reserved_quantity=0`, [v, q]);
    const mkCust = (phone) => admin.query(
      `INSERT INTO customers (id, first_name, phone) VALUES ($1,'G',$2) RETURNING id`, [uid(), phone])
      .then(r => r.rows[0].id);
    const mkAddr = (c) => admin.query(
      `INSERT INTO customer_addresses (id, customer_id, city, phone) VALUES ($1,$2,'Cairo','201000000001') RETURNING id`, [uid(), c])
      .then(r => r.rows[0].id);
    const mkCartW = (cust, variant, qty, unit, price) => (async () => {
      const c = (await admin.query(`INSERT INTO carts (id, customer_id) VALUES ($1,$2) RETURNING id`, [uid(), cust])).rows[0].id;
      await admin.query(`INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
        VALUES ($1,$2,$3,$4,$5, now())`, [c, variant, qty, unit, price]);
      return c;
    })();
    const ono = async () => {
      const r = await admin.query(`SELECT nextval('order_number_seq') n`);
      return 'HM-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(r.rows[0].n).padStart(6, '0');
    };

    // ---- frozen checkout worker (variant L=locked §F, N=naked conditional UPDATE) ----
    async function raceCheckout({ cartId, custId, addrId, key, locked, events, atReserve }) {
      const c = await pool.connect();
      try {
        events.begin = now();
        await c.query('BEGIN; SET LOCAL default_transaction_isolation = \'read committed\'');
        const cart = (await c.query('SELECT * FROM carts WHERE id=$1 FOR UPDATE', [cartId])).rows[0];
        if (!cart || cart.status !== 'ACTIVE') {
          const ex = await c.query('SELECT id FROM orders WHERE cart_id=$1', [cartId]);
          await c.query('ROLLBACK');
          return ex.rows.length ? { win: false, replay: true, order: ex.rows[0].id } : { win: false, reason: 'CART' };
        }
        const dup = await c.query('SELECT id FROM orders WHERE idempotency_key=$1', [key]);
        if (dup.rows.length) { await c.query('ROLLBACK'); return { win: false, replay: true, order: dup.rows[0].id }; }
        const l = (await c.query(`SELECT ci.*, v.price live_price, v.size_unit live_unit, v.is_active, v.deleted_at,
          p.product_type, p.sale_step_grams FROM cart_items ci JOIN product_variants v ON v.id=ci.product_variant_id
          JOIN products p ON p.id=v.product_id WHERE ci.cart_id=$1`, [cartId])).rows[0];
        const expU = l.product_type === 'WEIGHT' ? l.live_unit : 'PIECE';
        if (!l.is_active || l.deleted_at || l.unit_snapshot !== expU || String(l.live_price) !== String(l.unit_price_snapshot))
          throw new Error('VALIDATION');
        await eventsBarrierRelease(atReserve); // reservation-point latch: both workers overlap here
        events.lockTry = now();
        if (locked) await c.query('SELECT * FROM inventory WHERE product_variant_id=$1 FOR UPDATE', [l.product_variant_id]);
        events.lockGot = now();
        const r = await c.query(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2
          WHERE product_variant_id=$1 AND (quantity - reserved_quantity) >= $2`, [l.product_variant_id, l.quantity]);
        if (!r.rowCount) { await c.query('ROLLBACK'); return { win: false, reason: 'INSUFFICIENT' }; }
        const oid = uid(), on = await ono();
        const subR = (Math.round(Number(l.quantity) * Number(l.live_price) * 100) / 100).toFixed(2);
        await c.query(`INSERT INTO orders (id, order_number, customer_id, cart_id, idempotency_key, status,
          subtotal_estimated, discount_total, delivery_fee, total_estimated,
          customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_phone)
          VALUES ($1,$2,$3,$4,$5,'NEW',$6,0,0,$6,'G','201000000001','Cairo','201000000001')`,
          [oid, on, custId, cartId, key, subR]);
        await c.query(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_name_snapshot,
          unit_snapshot, product_type_snapshot, sale_step_snapshot, unit_price, requested_quantity, estimated_total)
          VALUES ($1,$2,'TEST','UNIT',$3,$4,$5,$6,$7,$8)`,
          [oid, l.product_variant_id, expU, l.product_type, l.sale_step_grams, l.live_price, l.quantity,
            (Math.round(Number(l.quantity) * Number(l.live_price) * 100) / 100).toFixed(2)]);
        await c.query(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id)
          VALUES ($1,NULL,'NEW','CUSTOMER',$2)`, [oid, custId]);
        await c.query(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [cartId]);
        events.preCommit = now();
        await c.query('COMMIT');
        events.commit = now();
        return { win: true, order: oid };
      } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { win: false, reason: 'ERR:' + e.message.split('\n')[0] }; }
      finally { c.release(); }
    }

    const invState = async (v) => (await admin.query(
      'SELECT quantity::text q, reserved_quantity::text r, available_quantity::text a FROM inventory WHERE product_variant_id=$1', [v])).rows[0];
    const checkInv = (s, tag) => {
      const badInv = !(Number(s.q) >= 0 && Number(s.r) >= 0 && Number(s.a) >= 0
        && Math.abs(Number(s.q) - (Number(s.a) + Number(s.r))) < 1e-9);
      if (badInv) throw new Error('INVARIANT BROKEN @' + tag + ' ' + JSON.stringify(s));
    };
    let phoneN = 0;
    const stats = { s1win: 0, s1iter: 0, overlap: 0, wWin: 0, wIter: 0, idem1: 0, idemIter: 0, cart1: 0, cartIter: 0, repOk: 0, repIter: 0 };

    // ==== Scenario 1: 1.000 unit, A=1 B=1, 100 iters, locked variant ====
    for (let i = 0; i < 100; i++) {
      await resetInv(VU, '1.000');
      const cA = await mkCust('2010000' + String(10000 + (phoneN++)));
      const cB = await mkCust('2010000' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA), aB = await mkAddr(cB);
      const kA = await mkCartW(cA, VU, '1.000', 'PIECE', '10.00');
      const kB = await mkCartW(cB, VU, '1.000', 'PIECE', '10.00');
      const gate = latch(2), rl = latch(2), eA = {}, eB = {};
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kA, custId: cA, addrId: aA, key: 'k1-' + i + '-A', locked: true, events: eA, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kB, custId: cB, addrId: aB, key: 'k1-' + i + '-B', locked: true, events: eB, atReserve: () => rl.arrive() }); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      if (wins !== 1) throw new Error(`iter ${i}: winners=${wins} ${JSON.stringify([rA, rB])}`);
      if (eA.begin < eB.commit && eB.begin < eA.commit) stats.overlap++;
      const s = await invState(VU);
      checkInv(s, 's1-' + i);
      if (!(s.r === '1.000' && s.a === '0.000')) throw new Error(`iter ${i}: reserve!=1 ${JSON.stringify(s)}`);
      const mv = await admin.query(`SELECT COUNT(*) c FROM inventory_movements WHERE product_variant_id=$1`, [VU]);
      if (mv.rows[0].c !== '0' && mv.rows[0].c !== 0) throw new Error(`iter ${i}: reserve created movements`);
      stats.s1win += wins; stats.s1iter++;
    }
    console.log(`S1 unit race ×100 (locked): winners/iter=1 ALWAYS, overlap proven ${stats.overlap}/100`);

    // ==== Scenario 1b: naked conditional UPDATE race ×25 ====
    let nakedWins = 0;
    for (let i = 0; i < 25; i++) {
      await resetInv(VU, '1.000');
      const cA = await mkCust('2010001' + String(10000 + (phoneN++)));
      const cB = await mkCust('2010001' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA), aB = await mkAddr(cB);
      const kA = await mkCartW(cA, VU, '1.000', 'PIECE', '10.00');
      const kB = await mkCartW(cB, VU, '1.000', 'PIECE', '10.00');
      const gate = latch(2), rl = latch(2), eA = {}, eB = {};
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kA, custId: cA, addrId: aA, key: 'k1n-' + i + '-A', locked: false, events: eA, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kB, custId: cB, addrId: aB, key: 'k1n-' + i + '-B', locked: false, events: eB, atReserve: () => rl.arrive() }); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      if (wins !== 1) throw new Error(`naked iter ${i}: winners=${wins}`);
      if (eA.begin < eB.commit && eB.begin < eA.commit) stats.overlap++;
      checkInv(await invState(VU), 's1n-' + i);
      nakedWins += wins;
    }
    console.log(`S1b unit race ×25 (naked UPDATE): winners/iter=1 ALWAYS — UPDATE itself is the atomic guard`);

    // ==== Scenario 2: weighted 1.000 KG, A=0.6 B=0.6 ×25 ====
    for (let i = 0; i < 25; i++) {
      await resetInv(VK, '1.000');
      const cA = await mkCust('2010002' + String(10000 + (phoneN++)));
      const cB = await mkCust('2010002' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA), aB = await mkAddr(cB);
      const kA = await mkCartW(cA, VK, '0.600', 'KG', '100.00');
      const kB = await mkCartW(cB, VK, '0.600', 'KG', '100.00');
      const gate = latch(2), rl = latch(2), eA = {}, eB = {};
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kA, custId: cA, addrId: aA, key: 'k2-' + i + '-A', locked: true, events: eA, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kB, custId: cB, addrId: aB, key: 'k2-' + i + '-B', locked: true, events: eB, atReserve: () => rl.arrive() }); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      if (wins !== 1) throw new Error(`weighted iter ${i}: winners=${wins}`);
      if (eA.begin < eB.commit && eB.begin < eA.commit) stats.overlap++;
      const s = await invState(VK);
      checkInv(s, 's2-' + i);
      if (s.r !== '0.600') throw new Error(`weighted iter ${i}: reserved=${s.r}`);
      stats.wWin += wins; stats.wIter++;
    }
    console.log(`S2 weighted race ×25 (0.6+0.6 on 1.0 KG): winners/iter=1 ALWAYS, reserved=0.600, invariants hold`);

    // ==== Scenario 3: idempotency race — SAME key, separate carts ×25 ====
    for (let i = 0; i < 25; i++) {
      await resetInv(VU, '10.000');
      const cA = await mkCust('2010003' + String(10000 + (phoneN++)));
      const cB = await mkCust('2010003' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA), aB = await mkAddr(cB);
      const kA = await mkCartW(cA, VU, '1.000', 'PIECE', '10.00');
      const kB = await mkCartW(cB, VU, '1.000', 'PIECE', '10.00');
      const key = 'same-key-' + i, gate = latch(2), rl = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kA, custId: cA, addrId: aA, key, locked: true, events: {}, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return raceCheckout({ cartId: kB, custId: cB, addrId: aB, key, locked: true, events: {}, atReserve: () => rl.arrive() }); })(),
      ]);
      const n = await admin.query(`SELECT COUNT(*) c, COUNT(DISTINCT id) d FROM orders WHERE idempotency_key=$1`, [key]);
      if (n.rows[0].c !== '1' && n.rows[0].c !== 1) throw new Error(`idem iter ${i}: orders=${n.rows[0].c}`);
      stats.idem1++; stats.idemIter++;
    }
    console.log(`S3 idempotency race ×25 (same key): exactly 1 logical order every time (UQ backstop + replay)`);

    // ==== Scenario 4: same-cart race ×25 ====
    for (let i = 0; i < 25; i++) {
      await resetInv(VU, '10.000');
      const cA = await mkCust('2010004' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA);
      const k = await mkCartW(cA, VU, '1.000', 'PIECE', '10.00');
      const gate = latch(2), rl = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return raceCheckout({ cartId: k, custId: cA, addrId: aA, key: 'ck-' + i + '-A', locked: true, events: {} }); })(),
        (async () => { await gate.arrive(); return raceCheckout({ cartId: k, custId: cA, addrId: aA, key: 'ck-' + i + '-B', locked: true, events: {} }); })(),
      ]);
      const n = await admin.query(`SELECT COUNT(*) c FROM orders WHERE cart_id=$1`, [k]);
      const cs = await admin.query(`SELECT status FROM carts WHERE id=$1`, [k]);
      if (Number(n.rows[0].c) !== 1 || cs.rows[0].status !== 'CHECKED_OUT')
        throw new Error(`cart iter ${i}: orders=${n.rows[0].c} status=${cs.rows[0].status}`);
      stats.cart1++; stats.cartIter++;
    }
    console.log(`S4 same-cart race ×25: exactly 1 order, cart CHECKED_OUT once (loser replays)`);

    // ==== Scenario 5: replacement races ×20 ====
    for (let i = 0; i < 20; i++) {
      await resetInv(VS, '1.000');
      const cA = await mkCust('2010005' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA);
      // order with UNAVAILABLE line (proposed in setup)
      const k = await mkCartW(cA, VU, '1.000', 'PIECE', '10.00');
      const gate0 = latch(1);
      await gate0.arrive();
      const co = await raceCheckout({ cartId: k, custId: cA, addrId: aA, key: 'rk-' + i, locked: true, events: {} });
      if (!co.win) throw new Error('setup checkout failed');
      await admin.query(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id)
        VALUES ($1,'CONFIRMED','PREPARING','STAFF',$2)`, [co.order, cA]);
      await admin.query(`UPDATE orders SET status='PREPARING' WHERE id=$1`, [co.order]);
      const line = (await admin.query(`SELECT id FROM order_items WHERE order_id=$1`, [co.order])).rows[0].id;
      await admin.query(`UPDATE order_items SET item_status='UNAVAILABLE' WHERE id=$1`, [line]);
      const rep = (await admin.query(`INSERT INTO order_item_replacements (order_item_id, replacement_variant_id,
        replacement_quantity, replacement_unit_price, price_difference, proposed_by_type, proposed_by_id)
        VALUES ($1,$2,'1.000',5.00,-5.00,'STAFF',$3) RETURNING id`, [line, VS, cA])).rows[0].id;
      // double-approve: same proposal from two sessions
      const approve = async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = (await c.query('SELECT * FROM order_item_replacements WHERE id=$1 FOR UPDATE', [rep])).rows[0];
          if (r.status !== 'PROPOSED') { await c.query('ROLLBACK'); return { win: false }; }
          const rv = await c.query(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2
            WHERE product_variant_id=$1 AND (quantity - reserved_quantity) >= $2`, [VS, '1.000']);
          if (!rv.rowCount) throw new Error('SUB_SHORT');
          const nl = (await c.query(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot,
            variant_name_snapshot, unit_snapshot, product_type_snapshot, unit_price, requested_quantity, estimated_total)
            VALUES ($1,$2,'TEST','SUB','PIECE','PIECE',5.00,'1.000',5.00) RETURNING id`,
            [co.order, VS])).rows[0].id;
          await c.query(`UPDATE order_item_replacements SET status='CUSTOMER_APPROVED', decided_by_type='CUSTOMER',
            decided_by_id=$2, replacement_order_item_id=$3 WHERE id=$1`, [rep, cA, nl]);
          await c.query(`UPDATE order_items SET item_status='REPLACED' WHERE id=$1`, [line]);
          await c.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id=$1`, [VU, '1.000']);
          await c.query('COMMIT');
          return { win: true };
        } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { win: false, reason: e.message.split('\n')[0] }; }
        finally { c.release(); }
      };
      const gate = latch(2), rl = latch(2);
      const [a1, a2] = await Promise.all([
        (async () => { await gate.arrive(); return approve(); })(),
        (async () => { await gate.arrive(); return approve(); })(),
      ]);
      const wins = [a1, a2].filter(x => x.win).length;
      const s = await invState(VS);
      const nl = await admin.query(`SELECT COUNT(*) c FROM order_items oi JOIN order_item_replacements r
        ON r.replacement_order_item_id = oi.id WHERE r.id=$1`, [rep]);
      if (wins !== 1 || s.r !== '1.000' || Number(nl.rows[0].c) !== 1)
        throw new Error(`rep iter ${i}: wins=${wins} sub_res=${s.r} lines=${nl.rows[0].c}`);
      checkInv(s, 's5-' + i);
      stats.repOk++; stats.repIter++;
    }
    console.log(`S5 double-approve race ×20: 1 materialization, substitute reserved exactly once`);
    // double-propose race ×20 (partial UQ guard)
    for (let i = 0; i < 20; i++) {
      const cA = await mkCust('2010006' + String(10000 + (phoneN++)));
      const aA = await mkAddr(cA);
      const k = await mkCartW(cA, VU, '1.000', 'PIECE', '10.00');
      await resetInv(VU, '10.000');
      const co = await raceCheckout({ cartId: k, custId: cA, addrId: aA, key: 'pk-' + i, locked: true, events: {} });
      const line = (await admin.query(`SELECT id FROM order_items WHERE order_id=$1`, [co.order])).rows[0].id;
      const propose = async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`UPDATE order_items SET item_status='UNAVAILABLE' WHERE id=$1`, [line]);
          await c.query(`INSERT INTO order_item_replacements (order_item_id, replacement_variant_id,
            replacement_quantity, replacement_unit_price, price_difference, proposed_by_type, proposed_by_id)
            VALUES ($1,$2,'1.000',5.00,-5.00,'STAFF',$3)`, [line, VS, cA]);
          await c.query('COMMIT');
          return { win: true };
        } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { win: false }; }
        finally { c.release(); }
      };
      const gate = latch(2), rl = latch(2);
      const [p1, p2] = await Promise.all([
        (async () => { await gate.arrive(); return propose(); })(),
        (async () => { await gate.arrive(); return propose(); })(),
      ]);
      const wins = [p1, p2].filter(x => x.win).length;
      const st = await admin.query(`SELECT item_status FROM order_items WHERE id=$1`, [line]);
      const pc = await admin.query(`SELECT COUNT(*) c FROM order_item_replacements WHERE order_item_id=$1 AND status='PROPOSED'`, [line]);
      if (wins !== 1 || Number(pc.rows[0].c) !== 1) throw new Error(`propose iter ${i}: wins=${wins} proposed=${pc.rows[0].c}`);
      void st;
    }
    console.log(`S5b double-propose race ×20: exactly 1 live PROPOSED (partial UQ holds under concurrency)`);

    console.log(`\n==== GATE RESULT: S1 ${stats.s1iter}/100 single-winner | overlap proven in ${stats.overlap} contended iterations | ALL INVARIANTS HELD ====`);
    process.exitCode = 0;
  } catch (e) { console.log('GATE ERROR: ' + String((e && e.message) || e).split('\n').slice(0, 4).join(' | ')); process.exitCode = 1; }
  try { await pool0.end(); } catch (_) {}
  try { await Promise.race([pool.end(), new Promise((_, rej) => setTimeout(() => rej(new Error('pool-end-timeout')), 10000))]); } catch (_) {}
  try { await Promise.race([pg.stop(), new Promise((_, rej) => setTimeout(() => rej(new Error('pg-stop-timeout')), 20000))]); } catch (e) { console.log('STOP: ' + e.message); }
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
})();
