// Overlap-proof probe: 10 iters, asserts BOTH workers reached the reservation
// latch AND loser.begin < winner.commit (genuine overlapping transactions).
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool } = require('pg');
const fs = require('fs');
process.on('unhandledRejection', (e) => { console.log('UNHANDLED: ' + String((e && e.message) || e).split('\n')[0]); process.exit(1); });
function latch(n) { let c = 0, rel; const ready = new Promise((r) => { rel = r; }); return { arrive: () => { if (++c === n) rel(); return ready; } }; }
let seq = 500000;
const uid = () => '7f000000-0000-7000-8000-' + (seq++).toString(16).padStart(12, '0');

(async () => {
  const pg = new EmbeddedPostgres({ databaseDir: './pgdata-probe', user: 'postgres', password: 'postgres', port: 55436, persistent: false });
  await pg.initialise();
  await pg.start();
  const p0 = new Pool({ host: '127.0.0.1', port: 55436, user: 'postgres', password: 'postgres', database: 'postgres', max: 2 });
  const s = await p0.connect();
  await s.query(`DROP DATABASE IF EXISTS gatedb`);
  await s.query(`CREATE DATABASE gatedb ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  s.release();
  const pool = new Pool({ host: '127.0.0.1', port: 55436, user: 'postgres', password: 'postgres', database: 'gatedb', max: 6 });
  const admin = await pool.connect();
  try {
    for (const f of ['phase1-schema.sql', 'phase1-seed-example.sql', 'phase2-schema.sql'])
      await admin.query(fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8'));
    await admin.query(`INSERT INTO products (id, name, slug, category_id, product_type, unit)
      VALUES ('7f000000-0000-7000-8000-000000000001','TEST Probe Unit','test-probe-unit','01800000-0000-7000-8000-000000000001','PIECE','PIECE')`);
    await admin.query(`INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price)
      VALUES ('7f000000-0000-7000-8000-000000000002','7f000000-0000-7000-8000-000000000001','UNIT',1,'PIECE',10.00)`);
    await admin.query(`INSERT INTO inventory (product_variant_id, quantity) VALUES ('7f000000-0000-7000-8000-000000000002',100.000)`);
    let proven = 0;
    for (let i = 0; i < 10; i++) {
      await admin.query(`UPDATE inventory SET quantity=1.000, reserved_quantity=0 WHERE product_variant_id='7f000000-0000-7000-8000-000000000002'`);
      const mk = async (ph) => {
        const c = (await admin.query(`INSERT INTO customers (id, first_name, phone) VALUES ($1,'G',$2) RETURNING id`, [uid(), ph])).rows[0].id;
        await admin.query(`INSERT INTO customer_addresses (id, customer_id, city, phone) VALUES ($1,$2,'Cairo','201000000001')`, [uid(), c]);
        const k = (await admin.query(`INSERT INTO carts (id, customer_id) VALUES ($1,$2) RETURNING id`, [uid(), c])).rows[0].id;
        await admin.query(`INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
          VALUES ($1,'7f000000-0000-7000-8000-000000000002','1.000','PIECE','10.00', now())`, [k]);
        return { c, k };
      };
      const A = await mk('2010099' + String(10000 + i * 2)), B = await mk('2010099' + String(10001 + i * 2));
      const gate = latch(2), rl = latch(2), eA = {}, eB = {};
      const worker = async (P, key, ev) => {
        const c = await pool.connect();
        try {
          ev.begin = Date.now();
          await c.query('BEGIN');
          await c.query('SELECT * FROM carts WHERE id=$1 FOR UPDATE', [P.k]);
          ev.arrived = true;
          await rl.arrive(); // latch BEFORE the shared inventory lock (else latch/lock deadlock)
          await c.query('SELECT * FROM inventory WHERE product_variant_id=$1 FOR UPDATE', ['7f000000-0000-7000-8000-000000000002']);
          const r = await c.query(`UPDATE inventory SET reserved_quantity = reserved_quantity + 1.000
            WHERE product_variant_id='7f000000-0000-7000-8000-000000000002' AND (quantity - reserved_quantity) >= 1.000`);
          if (!r.rowCount) { await c.query('ROLLBACK'); return { win: false }; }
          const on = 'HM-20260916-' + String((await admin.query(`SELECT nextval('order_number_seq') n`)).rows[0].n).padStart(6, '0');
          const oid = uid();
          await c.query(`INSERT INTO orders (id, order_number, customer_id, cart_id, idempotency_key, status,
            subtotal_estimated, discount_total, delivery_fee, total_estimated,
            customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_phone)
            VALUES ($1,$2,$3,$4,$5,'NEW',10,0,0,10,'G','201000000001','Cairo','201000000001')`, [oid, on, P.c, P.k, key]);
          await c.query(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id)
            VALUES ($1,NULL,'NEW','CUSTOMER',$2)`, [oid, P.c]);
          await c.query(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [P.k]);
          await c.query('COMMIT');
          ev.commit = Date.now();
          return { win: true };
        } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { win: false, reason: e.message.split('\n')[0] }; }
        finally { c.release(); }
      };
      const [rA, rB] = await Promise.all([
        (async () => { await gate.arrive(); return worker(A, 'pv-' + i + '-A', eA); })(),
        (async () => { await gate.arrive(); return worker(B, 'pv-' + i + '-B', eB); })(),
      ]);
      const wins = [rA, rB].filter(r => r.win).length;
      if (wins !== 1) throw new Error(`iter ${i}: winners=${wins}`);
      if (!(eA.arrived && eB.arrived)) throw new Error(`iter ${i}: latch not reached by both`);
      const W = rA.win ? { c: eA.commit, b: eB.begin } : { c: eB.commit, b: eA.begin };
      if (!(W.b < W.c)) throw new Error(`iter ${i}: no overlap`);
      proven++;
      const inv = (await admin.query(`SELECT quantity::text q, reserved_quantity::text r, available_quantity::text a
        FROM inventory WHERE product_variant_id='7f000000-0000-7000-8000-000000000002'`)).rows[0];
      if (!(inv.q === '1.000' && inv.r === '1.000' && inv.a === '0.000')) throw new Error(`iter ${i}: state ${JSON.stringify(inv)}`);
    }
    console.log(`OVERLAP PROBE: ${proven}/10 iters — dual latch arrival AND loser.begin < winner.commit, single winner, 1.000/1.000/0.000 every time`);
    process.exitCode = 0;
  } catch (e) { console.log('PROBE ERROR: ' + String((e && e.message) || e).split('\n').slice(0, 4).join(' | ')); process.exitCode = 1; }
  try { await pool.end(); } catch (_) {}
  try { await p0.end(); } catch (_) {}
  try { await Promise.race([pg.stop(), new Promise((_, rej) => setTimeout(() => rej(new Error('t/o')), 20000))]); } catch (e) { console.log('STOP: ' + e.message); }
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
})();
