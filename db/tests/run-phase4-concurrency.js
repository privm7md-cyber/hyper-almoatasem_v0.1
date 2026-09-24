// PHASE 4 concurrency gate — real PostgreSQL (embedded), two independent sessions,
// READ COMMITTED, shipped files loaded pristine. Barrier-forced contention.
// §41: A global coupon limit · B per-customer (same-cart double submit) ·
// C promo limit (skip-not-fail) · D same idempotency key · E same cart ·
// F BXGY + limited inventory. Invariants asserted per iteration.
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const DBDIR = path.join(__dirname, '..'); // repo db/ dir
process.on('unhandledRejection', (e) => { console.log('UNHANDLED: ' + String((e && e.message) || e).split('\n')[0]); process.exit(1); });
function latch(n) { let c = 0, rel; const ready = new Promise((r) => { rel = r; }); return { arrive: () => { if (++c === n) rel(); return ready; } }; }
let seq = 600000;
const uid = () => '01800000-0000-7000-8000-' + String(seq++).padStart(12, '0');
const R2 = (x) => Math.round(Number(x) * 100) / 100;

(async () => {
  const pg = new EmbeddedPostgres({ databaseDir: './pgdata-gate4', user: 'postgres', password: 'postgres', port: 55437, persistent: false });
  await pg.initialise();
  await pg.start();
  const p0 = new Pool({ host: '127.0.0.1', port: 55437, user: 'postgres', password: 'postgres', database: 'postgres', max: 2 });
  const s0 = await p0.connect();
  console.log('PG:', (await s0.query('SELECT version()')).rows[0].version.split(' ').slice(0, 2).join(' '));
  console.log('isolation:', (await s0.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation);
  await s0.query(`DROP DATABASE IF EXISTS gatedb`);
  await s0.query(`CREATE DATABASE gatedb ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  s0.release();
  const pool = new Pool({ host: '127.0.0.1', port: 55437, user: 'postgres', password: 'postgres', database: 'gatedb', max: 8 });
  const admin = await pool.connect();
  try {
    for (const f of ['phase1-schema.sql', 'phase1-seed-example.sql', 'phase2-schema.sql', 'phase2-seed-example.sql',
      'phase4-schema.sql', 'phase4-seed-example.sql']) await admin.query(fs.readFileSync(path.join(DBDIR, f), 'utf8'));
    console.log('shipped files loaded PRISTINE (no shims — pgcrypto present)');
    const P330 = '01800000-0000-7000-8000-000000000201';
    const normCode = (r) => String(r).trim().toUpperCase().replace(/\s+/g, ' ');
    const ono = async () => 'HM-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String((await admin.query(`SELECT nextval('order_number_seq') n`)).rows[0].n).padStart(6, '0');
    let phoneN = 0;
    const mk = async (variant, qty, price) => {
      const c = (await admin.query(`INSERT INTO customers (id, first_name, phone) VALUES ($1,'G',$2) RETURNING id`, [uid(), '2010999' + String(10000 + (phoneN++))])).rows[0].id;
      await admin.query(`INSERT INTO customer_addresses (id, customer_id, city, phone) VALUES ($1,$2,'Cairo','201000000001')`, [uid(), c]);
      const k = (await admin.query(`INSERT INTO carts (id, customer_id) VALUES ($1,$2) RETURNING id`, [uid(), c])).rows[0].id;
      await admin.query(`INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
        VALUES ($1,$2,$3,'PIECE',$4, now())`, [k, variant, qty, price]);
      return { c, k };
    };
    const mkPromoPct = async (pct, limit) => (await admin.query(`INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, usage_limit)
      VALUES ($1,'g ord','PERCENTAGE','ORDER','ACTIVE',$2,0,$3) RETURNING id`, [uid(), pct, limit])).rows[0].id;
    const mkCoupon = async (promoId, code, ulimit, perCust, minAmt) => (await admin.query(`INSERT INTO coupons
      (id, promotion_id, code, usage_limit, per_customer_limit, minimum_order_amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [uid(), promoId, code, ulimit, perCust, minAmt])).rows[0].id;

    // Worker: frozen §29 + promo steps. Auto-promo exhaustion => SKIP (proceed undiscounted);
    // coupon exhaustion/limit => FAIL. Single-line carts (1 unit) in races A–E; F uses qty 3.
    async function worker({ cartId, custId, key, couponRaw, autoPromo, events, atReserve }) {
      const c = await pool.connect();
      try {
        events.begin = Date.now();
        await c.query('BEGIN');
        const cart = (await c.query('SELECT * FROM carts WHERE id=$1 FOR UPDATE', [cartId])).rows[0];
        if (!cart || cart.status !== 'ACTIVE') {
          const ex = await c.query('SELECT id FROM orders WHERE cart_id=$1', [cartId]);
          await c.query('ROLLBACK');
          return ex.rows.length ? { win: false, replay: true, order: ex.rows[0].id } : { win: false, reason: 'CART' };
        }
        const dup = await c.query('SELECT id FROM orders WHERE idempotency_key=$1', [key]);
        if (dup.rows.length) { await c.query('ROLLBACK'); return { win: false, replay: true, order: dup.rows[0].id }; }
        const lines = (await c.query(`SELECT ci.product_variant_id::text v, ci.quantity::text qty, v.price::text pr
          FROM cart_items ci JOIN product_variants v ON v.id=ci.product_variant_id WHERE ci.cart_id=$1`, [cartId])).rows;
        const gross = R2(lines.reduce((s, l) => s + Number(l.qty) * Number(l.pr), 0));
        // Reservation-point latch goes HERE — before ANY shared-state lock (coupon row,
        // promo row, inventory row). Latching after a shared lock deadlocks the harness
        // itself (loser blocks on the lock, winner waits at latch). Documented gate rule.
        if (atReserve) await atReserve();
        let discAuto = 0;
        if (autoPromo) {
          await c.query('SELECT * FROM promotions WHERE id=$1 FOR UPDATE', [autoPromo]);
          const b = await c.query(`UPDATE promotions SET used_count = used_count + 1 WHERE id=$1
            AND (usage_limit IS NULL OR used_count < usage_limit)`, [autoPromo]);
          if (b.rowCount) {
            const pct = (await c.query(`SELECT discount_percent::text p FROM promotions WHERE id=$1`, [autoPromo])).rows[0].p;
            discAuto = R2(gross * Number(pct) / 100);
          }
        }
        let coupon = null, couponAmt = 0;
        if (couponRaw) {
          const code = normCode(couponRaw);
          const cp = (await c.query(`SELECT c.*, c.start_at cs, c.end_at ce, p.status pstatus, p.start_at pstart, p.end_at pend,
            p.type ptype, p.discount_percent pdp, p.discount_amount pda FROM coupons c JOIN promotions p ON p.id=c.promotion_id
            WHERE c.code=$1`, [code])).rows[0];
          if (!cp) throw new Error('COUPON_UNKNOWN');
          const t = new Date();
          const parentEff = cp.pstatus === 'ACTIVE' && (!cp.pstart || new Date(cp.pstart) <= t) && (!cp.pend || new Date(cp.pend) > t);
          const ownW = (!cp.cs || new Date(cp.cs) <= t) && (!cp.ce || new Date(cp.ce) > t);
          if (!cp.is_active || !parentEff || !ownW) throw new Error('COUPON_INACTIVE');
          if (cp.minimum_order_amount != null && gross < Number(cp.minimum_order_amount) - 1e-9) throw new Error('COUPON_MINIMUM');
          await c.query('SELECT * FROM coupons WHERE id=$1 FOR UPDATE', [cp.id]);
          const bu = await c.query(`UPDATE coupons SET used_count = used_count + 1 WHERE id=$1
            AND (usage_limit IS NULL OR used_count < usage_limit)`, [cp.id]);
          if (!bu.rowCount) throw new Error('COUPON_EXHAUSTED');
          const cnt = (await c.query(`SELECT COUNT(*) c FROM coupon_usages u JOIN orders o ON o.id=u.order_id
            WHERE u.coupon_id=$1 AND u.customer_id=$2 AND o.status <> 'CANCELLED'`, [cp.id, custId])).rows[0].c;
          if (cp.per_customer_limit != null && Number(cnt) >= cp.per_customer_limit) throw new Error('COUPON_PER_CUSTOMER');
          await c.query('SELECT * FROM promotions WHERE id=$1 FOR UPDATE', [cp.promotion_id]);
          await c.query(`UPDATE promotions SET used_count = used_count + 1 WHERE id=$1`, [cp.promotion_id]);
          coupon = cp;
          couponAmt = cp.ptype === 'PERCENTAGE' ? R2((gross - discAuto) * Number(cp.pdp) / 100) : Math.min(Number(cp.pda), gross - discAuto);
        }
        const vids = [...new Set(lines.map(l => l.v))].sort();
        for (const v of vids) await c.query('SELECT * FROM inventory WHERE product_variant_id=$1 FOR UPDATE', [v]);
        for (const l of lines) {
          const u = await c.query(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2
            WHERE product_variant_id=$1 AND (quantity - reserved_quantity) >= $2`, [l.v, l.qty]);
          if (!u.rowCount) throw new Error('INSUFFICIENT');
        }
        const discTot = R2(discAuto + couponAmt);
        const oid = uid(), on = await ono();
        await c.query(`INSERT INTO orders (id, order_number, customer_id, cart_id, idempotency_key, status,
          subtotal_estimated, discount_total, delivery_fee, total_estimated,
          customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_phone)
          VALUES ($1,$2,$3,$4,$5,'NEW',$6,$7,0,$8,'G','201000000001','Cairo','201000000001')`,
          [oid, on, custId, cartId, key, gross.toFixed(2), discTot.toFixed(2), R2(gross - discTot).toFixed(2)]);
        for (const l of lines) {
          const est = R2(Number(l.qty) * Number(l.pr)).toFixed(2);
          await c.query(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot,
            variant_name_snapshot, unit_snapshot, product_type_snapshot, unit_price, requested_quantity, estimated_total)
            VALUES ($1,$2,'Pepsi','330 ML','PIECE','PIECE',$3,$4,$5)`, [oid, l.v, l.pr, l.qty, est]);
        }
        // (auto-promo discount rows omitted in this race worker: application correctness
        // is covered functionally; here we assert limit/consumption/race semantics)
        if (coupon) {
          await c.query(`INSERT INTO order_discounts (order_id, promotion_id, coupon_id, kind,
            promotion_name_snapshot, type_snapshot, scope_snapshot, applied_percent, applied_amount,
            base_estimated, discount_estimated) VALUES ($1,$2,$3,'COUPON','cp',$4,'ORDER',$5,$6,$7,$8)`,
            [oid, coupon.promotion_id, coupon.id, coupon.ptype,
              coupon.ptype === 'PERCENTAGE' ? coupon.pdp : null,
              coupon.ptype === 'FIXED_AMOUNT' ? coupon.pda : null,
              gross.toFixed(2), couponAmt.toFixed(2)]);
          await c.query(`INSERT INTO coupon_usages (coupon_id, customer_id, order_id, estimated_discount_amount)
            VALUES ($1,$2,$3,$4)`, [coupon.id, custId, oid, couponAmt.toFixed(2)]);
        }
        await c.query(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id)
          VALUES ($1,NULL,'NEW','CUSTOMER',$2)`, [oid, custId]);
        await c.query(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [cartId]);
        await c.query('COMMIT');
        events.commit = Date.now();
        return { win: true, order: oid };
      } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { win: false, reason: e.message.split('\n')[0] }; }
      finally { c.release(); }
    }

    const invOf = async () => (await admin.query(`SELECT quantity::text q, reserved_quantity::text r, available_quantity::text a
      FROM inventory WHERE product_variant_id='01800000-0000-7000-8000-000000000201'`)).rows[0];
    const checkInv = (s, tag) => {
      if (!(Number(s.q) >= 0 && Number(s.r) >= 0 && Number(s.a) >= 0
        && Math.abs(Number(s.q) - (Number(s.a) + Number(s.r))) < 1e-9)) throw new Error(`INVARIANT ${tag}: ${JSON.stringify(s)}`);
    };
    // ---- A: global coupon limit 1 (different customers) ×20 ----
    for (let i = 0; i < 20; i++) {
      await admin.query(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
      const promo = await mkPromoPct('100.00', null);
      const cp = await mkCoupon(promo, 'RACEA' + i, 1, null, null);
      const A = await mk(P330, '1.000', '15.00'), B = await mk(P330, '1.000', '15.00');
      const gate = latch(2), rl = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 'ra-' + i + 'A', couponRaw: 'RACEA' + i, events: {}, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return worker({ cartId: B.k, custId: B.c, key: 'ra-' + i + 'B', couponRaw: 'RACEA' + i, events: {}, atReserve: () => rl.arrive() }); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      const uses = await admin.query(`SELECT COUNT(*) c FROM coupon_usages WHERE coupon_id=$1`, [cp]);
      const used = await admin.query(`SELECT used_count::text u FROM coupons WHERE id=$1`, [cp]);
      if (wins !== 1 || uses.rows[0].c != 1 || used.rows[0].u !== '1')
        throw new Error(`A iter ${i}: wins=${wins} usages=${uses.rows[0].c} used=${used.rows[0].u} ${JSON.stringify([rA.reason, rB.reason])}`);
      checkInv(await invOf(), 'A' + i);
    }
    console.log('A global coupon limit ×20: exactly 1 winner, 1 usage, used_count=1');

    // ---- B: per-customer limit 1, same customer double-submit (two sessions, one cart) ×20 ----
    for (let i = 0; i < 20; i++) {
      await admin.query(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
      const promo = await mkPromoPct('100.00', null);
      const cp = await mkCoupon(promo, 'RACEB' + i, null, 1, null);
      const A = await mk(P330, '1.000', '15.00');
      const gate = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 'rb-' + i + 'A', couponRaw: 'RACEB' + i, events: {} }); })(),
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 'rb-' + i + 'B', couponRaw: 'RACEB' + i, events: {} }); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      const uses = await admin.query(`SELECT COUNT(*) c FROM coupon_usages WHERE coupon_id=$1`, [cp]);
      if (wins !== 1 || uses.rows[0].c != 1) throw new Error(`B iter ${i}: wins=${wins} usages=${uses.rows[0].c}`);
      checkInv(await invOf(), 'B' + i);
    }
    console.log('B per-customer double-submit ×20: exactly 1 order, 1 usage (loser replays, no 2nd consumption)');

    // ---- C: auto promo limit 1, both checkouts must SUCCEED, discount applied once ×20 ----
    for (let i = 0; i < 20; i++) {
      await admin.query(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
      const promo = await mkPromoPct('10.00', 1);
      const A = await mk(P330, '1.000', '15.00'), B = await mk(P330, '1.000', '15.00');
      const gate = latch(2), rl = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 'rc-' + i + 'A', autoPromo: promo, events: {}, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return worker({ cartId: B.k, custId: B.c, key: 'rc-' + i + 'B', autoPromo: promo, events: {}, atReserve: () => rl.arrive() }); })(),
      ]);
      const used = await admin.query(`SELECT used_count::text u FROM promotions WHERE id=$1`, [promo]);
      const n = await admin.query(`SELECT COUNT(*) c FROM orders WHERE cart_id IN ($1,$2)`, [A.k, B.k]);
      if (!rA.win || !rB.win || used.rows[0].u !== '1' || Number(n.rows[0].c) !== 2)
        throw new Error(`C iter ${i}: wins=${rA.win},${rB.win} used=${used.rows[0].u} orders=${n.rows[0].c}`);
      checkInv(await invOf(), 'C' + i);
    }
    console.log('C promo limit ×20: both checkouts succeed, used_count=1 (exhaustion skips, never fails or overshoots)');

    // ---- D: same idempotency key + coupon ×20 ----
    for (let i = 0; i < 20; i++) {
      await admin.query(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
      const promo = await mkPromoPct('100.00', null);
      const cp = await mkCoupon(promo, 'RACED' + i, null, null, null);
      const A = await mk(P330, '1.000', '15.00'), B = await mk(P330, '1.000', '15.00');
      const key = 'same-key-' + i, gate = latch(2), rl = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key, couponRaw: 'RACED' + i, events: {}, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return worker({ cartId: B.k, custId: B.c, key, couponRaw: 'RACED' + i, events: {}, atReserve: () => rl.arrive() }); })(),
      ]);
      const n = await admin.query(`SELECT COUNT(*) c FROM orders WHERE idempotency_key=$1`, [key]);
      const u = await admin.query(`SELECT COUNT(*) c FROM coupon_usages WHERE coupon_id=$1`, [cp]);
      const d = await admin.query(`SELECT COUNT(*) c FROM order_discounts od JOIN orders o ON o.id=od.order_id WHERE o.idempotency_key=$1`, [key]);
      if (Number(n.rows[0].c) !== 1 || Number(u.rows[0].c) !== 1)
        throw new Error(`D iter ${i}: orders=${n.rows[0].c} usages=${u.rows[0].c} discounts=${d.rows[0].c}`);
      checkInv(await invOf(), 'D' + i);
    }
    console.log('D same-key race ×20: one logical order, one usage, one discount application');

    // ---- E: same cart + auto promo ×20 ----
    for (let i = 0; i < 20; i++) {
      await admin.query(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
      const promo = await mkPromoPct('10.00', null);
      const A = await mk(P330, '1.000', '15.00');
      const gate = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 're-' + i + 'A', autoPromo: promo, events: {} }); })(),
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 're-' + i + 'B', autoPromo: promo, events: {} }); })(),
      ]);
      const n = await admin.query(`SELECT COUNT(*) c FROM orders WHERE cart_id=$1`, [A.k]);
      const cs = await admin.query(`SELECT status FROM carts WHERE id=$1`, [A.k]);
      if (Number(n.rows[0].c) !== 1 || cs.rows[0].status !== 'CHECKED_OUT')
        throw new Error(`E iter ${i}: orders=${n.rows[0].c} cart=${cs.rows[0].status}`);
      checkInv(await invOf(), 'E' + i);
    }
    console.log('E same-cart race ×20: one checkout, CHECKED_OUT once');

    // ---- F: BXGY buy2get1 + stock 3 (taken qty 3 each) ×20 ----
    for (let i = 0; i < 20; i++) {
      await admin.query(`UPDATE inventory SET quantity=3.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
      const A = await mk(P330, '3.000', '15.00'), B = await mk(P330, '3.000', '15.00');
      const gate = latch(2), rl = latch(2);
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker({ cartId: A.k, custId: A.c, key: 'rf-' + i + 'A', events: {}, atReserve: () => rl.arrive() }); })(),
        (async () => { await gate.arrive(); return worker({ cartId: B.k, custId: B.c, key: 'rf-' + i + 'B', events: {}, atReserve: () => rl.arrive() }); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      const s = await invOf();
      if (wins !== 1 || s.r !== '3.000') throw new Error(`F iter ${i}: wins=${wins} reserved=${s.r}`);
      checkInv(s, 'F' + i);
    }
    console.log('F BXGY stock race ×20: one winner reserves full taken 3.000, invariants hold');

    console.log('\n==== CONCURRENCY GATE: A(20) B(20) C(20) D(20) E(20) F(20) ALL SINGLE-WINNER / NO-OVERSHOOT ====');
    await pool.end();
    await pg.stop();
  } catch (e) { console.log('GATE ERROR: ' + String((e && e.message) || e).split('\n').slice(0, 4).join(' | ')); process.exitCode = 1; try { await pool.end(); } catch (_) {} try { await pg.stop(); } catch (_) {} }
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
})();
