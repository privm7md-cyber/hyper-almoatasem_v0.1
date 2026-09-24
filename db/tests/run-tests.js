// PHASE 2 test harness — runs REAL PostgreSQL 18 (PGlite) against the SHIPPED files.
// TEST-ENV SHIMS ONLY (never shipped): (1) the Phase 1 `CREATE EXTENSION pgcrypto`
// line is neutralised in-memory (PGlite has no contrib) + a stub gen_random_uuid()
// is defined for DDL parsing; every test sends explicit UUIDs so the stub never fires.
// Shipped file bytes on disk are untouched.
// Reference implementations below (checkout/commitPick/approveReplacement/merge/normalize)
// are TEST DOUBLES encoding the frozen rules R1–R10 — not product backend code.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');

const path = require('path');
const DBDIR = path.join(__dirname, '..');
const P1_SCHEMA = path.join(DBDIR, 'phase1-schema.sql');
const P1_SEED = path.join(DBDIR, 'phase1-seed-example.sql');
const P2_SCHEMA = path.join(DBDIR, 'phase2-schema.sql');
const P2_SEED = path.join(DBDIR, 'phase2-seed-example.sql');

const ROMI_V = '01800000-0000-7000-8000-000000000101'; // KG, 320.00, step 125
const P330 = '01800000-0000-7000-8000-000000000201';   // PIECE, 15.00
const P1L = '01800000-0000-7000-8000-000000000202';    // LITER, 30.00
const P25L = '01800000-0000-7000-8000-000000000203';   // LITER, 55.00
const STAFF = '01800000-0000-7000-8000-000000000399';

const uid = (n) => '01800000-0000-7000-8000-' + String(n).padStart(12, '0');
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS ' + name); };
const bad = (name, e) => { fail++; console.log('FAIL ' + name + ' :: ' + String(e && e.message || e).split('\n')[0]); };
const expectReject = async (name, fn, needle) => {
  try { await fn(); bad(name, 'expected rejection, succeeded'); }
  catch (e) {
    if (needle && !String(e.message).includes(needle)) bad(name, 'wrong error: ' + e.message.split('\n')[0]);
    else ok(name);
  }
};

// R8 reference normalizer (test double of the app writer path).
function normalizePhone(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^0\d{10}$/.test(d)) d = '20' + d.slice(1);
  else if (/^1\d{9}$/.test(d)) d = '20' + d;
  else if (!/^20\d{10}$/.test(d)) throw new Error('REJECT phone: ' + raw);
  if (!/^201[0125][0-9]{8}$/.test(d)) throw new Error('REJECT non-EG-mobile: ' + raw);
  return d;
}

(async () => {
  const db = new PGlite();
  const q = (sql, p) => db.query(sql, p);

  // ---- load shipped files (phase1 EXTENSION line neutralised in-memory only) ----
  const p1 = fs.readFileSync(P1_SCHEMA, 'utf8')
    .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- [TEST SHIM] pgcrypto unavailable in PGlite; stub below');
  await db.exec(`CREATE OR REPLACE FUNCTION gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$
    SELECT format('%s-%s-4%s-%s-%s', substr(m,1,8), substr(m,9,4), substr(m,13,3), substr(m,17,4), substr(m,21,12))::uuid
    FROM md5(random()::text || clock_timestamp()::text) AS m; $$;`);
  await db.exec(p1);
  await db.exec(fs.readFileSync(P1_SEED, 'utf8'));
  await db.exec(fs.readFileSync(P2_SCHEMA, 'utf8'));
  await db.exec(fs.readFileSync(P2_SEED, 'utf8'));
  ok('SETUP shipped files load (phase1+phase2 schema & seeds)');

  const inv = async (v) => (await q(
    'SELECT quantity::text q, reserved_quantity::text r, available_quantity::text a FROM inventory WHERE product_variant_id=$1', [v])).rows[0];
  const assertInv = async (name, v, Q, R, A) => {
    const r = await inv(v);
    (r.q === Q && r.r === R && r.a === A) ? ok(name) : bad(name, `got q=${r.q} r=${r.r} a=${r.a}, want ${Q}/${R}/${A}`);
  };
  const assertInvariant = async (name) => {
    const r = await q(`SELECT COUNT(*) c FROM inventory WHERE NOT (quantity = available_quantity + reserved_quantity)
      OR quantity < 0 OR reserved_quantity < 0 OR available_quantity < 0`);
    (r.rows[0].c === 0 || r.rows[0].c === '0') ? ok(name) : bad(name, 'invariant broken');
  };

  const mkCustomer = (id, phone, extra = {}) => q(
    `INSERT INTO customers (id, first_name, last_name, phone, email, password_hash, is_registered, is_active)
     VALUES ($1,'T','L',$2,$3,$4,$5,TRUE)`, [id, phone, extra.email || null, extra.hash || null, !!extra.hash]);
  const mkAddr = (id, cust, isDef) => q(
    `INSERT INTO customer_addresses (id, customer_id, city, phone, is_default) VALUES ($1,$2,'Cairo','201000000000',$3)`,
    [id, cust, isDef]);
  const mkCart = (id, owner, status = 'ACTIVE') => owner.c
    ? q(`INSERT INTO carts (id, customer_id, status) VALUES ($1,$2,$3)`, [id, owner.c, status])
    : q(`INSERT INTO carts (id, session_id, status, expires_at) VALUES ($1,$2,$3, now() + INTERVAL '30 days')`, [id, owner.s, status]);
  const mkLine = (id, cart, variant, qty, unit, price) => q(
    `INSERT INTO cart_items (id, cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())`, [id, cart, variant, qty, unit, price]);
  const orderNo = async () => {
    const r = await q(`SELECT nextval('order_number_seq') n`);
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `HM-${d}-` + String(r.rows[0].n).padStart(6, '0');
  };
  const hist = (oid, o, n, at, aid, note) =>
    q(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id, note) VALUES ($1,$2,$3,$4,$5,$6)`,
      [oid, o, n, at, aid, note || null]);
  const advance = async (oid, from, to, at = 'STAFF', aid = STAFF) => {
    await hist(oid, from, to, at, aid);
    await q(`UPDATE orders SET status=$2 WHERE id=$1`, [oid, to]);
  };

  // ---- reference checkout (frozen §F): returns {ok, orderId} or {ok:false, reason} ----
  async function checkout({ cartId, customerId, addressId, key, fee = 20, disc = 0, confirmPrices = false }) {
    await q('BEGIN');
    try {
      const c = (await q('SELECT * FROM carts WHERE id=$1 FOR UPDATE', [cartId])).rows[0];
      if (!c) throw new Error('NO_CART');
      if (c.status !== 'ACTIVE') {
        const ex = await q('SELECT id FROM orders WHERE cart_id=$1', [cartId]);
        await q('ROLLBACK');
        return ex.rows.length ? { ok: true, replay: true, orderId: ex.rows[0].id } : { ok: false, reason: 'CART_NOT_ACTIVE' };
      }
      const dup = await q('SELECT id FROM orders WHERE idempotency_key=$1', [key]);
      if (dup.rows.length) { await q('ROLLBACK'); return { ok: true, replay: true, orderId: dup.rows[0].id }; }
      const lines = (await q(`SELECT ci.*, v.price AS live_price, v.size_unit AS live_unit, v.is_active, v.deleted_at,
        p.product_type, p.sale_step_grams FROM cart_items ci
        JOIN product_variants v ON v.id = ci.product_variant_id
        JOIN products p ON p.id = v.product_id WHERE ci.cart_id=$1`, [cartId])).rows;
      if (!lines.length) throw new Error('EMPTY_CART');
      const diffs = [];
      for (const l of lines) {
        if (!l.is_active || l.deleted_at) throw new Error('LINE_DEAD:' + l.id);
        // Counting-unit rule (frozen A11/A12 intent): PIECE lines count packs ('PIECE');
        // WEIGHT lines count variant size_unit. Any reinterpretation risk aborts the line.
        const expectedUnit = l.product_type === 'WEIGHT' ? l.live_unit : 'PIECE';
        if (l.unit_snapshot !== expectedUnit) throw new Error('UNIT_CHANGED:' + l.id);
        if (String(l.live_price) !== String(l.unit_price_snapshot)) diffs.push(l.id);
        if (l.product_type === 'WEIGHT') {
          const grams = l.live_unit === 'KG' ? Number(l.quantity) * 1000 : Number(l.quantity);
          if (Math.round(grams * 1000) % (l.sale_step_grams * 1000) !== 0
            && Math.abs(grams / l.sale_step_grams - Math.round(grams / l.sale_step_grams)) > 1e-9)
            throw new Error('STEP_VIOLATION:' + l.id);
        }
      }
      if (diffs.length && !confirmPrices) { await q('ROLLBACK'); return { ok: false, reason: 'PRICE_CHANGED', diffs }; }
      const vids = [...new Set(lines.map(l => l.product_variant_id))].sort();
      for (const v of vids) await q('SELECT * FROM inventory WHERE product_variant_id=$1 FOR UPDATE', [v]);
      for (const l of lines) {
        const price = confirmPrices && diffs.includes(l.id) ? l.live_price : l.unit_price_snapshot;
        l._price = price;
        l._unit = l.product_type === 'WEIGHT' ? l.live_unit : 'PIECE'; // counting unit (see validation above)
        const r = await q(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2
          WHERE product_variant_id=$1 AND (quantity - reserved_quantity) >= $2
          RETURNING product_variant_id`, [l.product_variant_id, l.quantity]);
        if (!r.rows.length) throw new Error('INSUFFICIENT:' + l.id);
      }
      const cust = (await q('SELECT * FROM customers WHERE id=$1', [customerId])).rows[0];
      const addr = (await q('SELECT * FROM customer_addresses WHERE id=$1 AND customer_id=$2', [addressId, customerId])).rows[0];
      if (!cust || !cust.is_active || cust.deleted_at || !addr) throw new Error('BAD_CUSTOMER_OR_ADDRESS');
      const sub = lines.reduce((s, l) => s + Math.round(Number(l.quantity) * Number(l._price) * 100) / 100, 0);
      const subR = Math.round(sub * 100) / 100;
      const oid = uid(9000 + Math.floor(Math.random() * 800));
      const ono = await orderNo();
      await q(`INSERT INTO orders (id, order_number, customer_id, cart_id, idempotency_key, status,
        subtotal_estimated, discount_total, delivery_fee, total_estimated,
        customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_area, delivery_phone)
        VALUES ($1,$2,$3,$4,$5,'NEW',$6,$7,$8,$9,'T','201000000000','Cairo','Nasr','201000000000')`,
        [oid, ono, customerId, cartId, key, subR.toFixed(2), disc.toFixed(2), fee.toFixed(2),
          (Math.round((subR - disc + fee) * 100) / 100).toFixed(2)]);
      for (const l of lines) {
        const v = (await q(`SELECT v.name vn, p.name pn, p.product_type pt, p.sale_step_grams ss, b.name bn
          FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN brands b ON b.id=p.brand_id
          WHERE v.id=$1`, [l.product_variant_id])).rows[0];
        const code = (await q(`SELECT code, type FROM product_codes WHERE product_variant_id=$1 AND is_primary`, [l.product_variant_id])).rows[0];
        const est = (Math.round(Number(l.quantity) * Number(l._price) * 100) / 100).toFixed(2);
        await q(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_name_snapshot,
          brand_name_snapshot, product_code_snapshot, code_type_snapshot, unit_snapshot, product_type_snapshot,
          sale_step_snapshot, unit_price, requested_quantity, estimated_total)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [oid, l.product_variant_id, v.pn, v.vn, v.bn, code ? code.code : null, code ? code.type : null,
            l._unit, v.pt, v.ss, Number(l._price).toFixed(2), l.quantity, est]);
      }
      await hist(oid, null, 'NEW', 'CUSTOMER', customerId);
      await hist(oid, 'NEW', 'CONFIRMED', 'CUSTOMER', customerId);
      await q(`UPDATE orders SET status='CONFIRMED' WHERE id=$1`, [oid]);
      await q(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [cartId]);
      await q('COMMIT');
      return { ok: true, orderId: oid };
    } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
  }

  // ---- reference commitPick (frozen R7) ----
  async function commitPick(itemId, actual, note) {
    await q('BEGIN');
    try {
      const it = (await q(`SELECT oi.*, o.status AS ostatus FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE oi.id=$1 FOR UPDATE`, [itemId])).rows[0];
      if (!it || it.ostatus !== 'PREPARING' || it.item_status !== 'PENDING') throw new Error('BAD_STATE');
      const tol = it.product_type_snapshot === 'WEIGHT'
        ? Math.max(it.unit_snapshot === 'KG' ? it.sale_step_snapshot / 1000 : it.sale_step_snapshot,
          Number(it.requested_quantity) * 0.1) : 0;
      if (Number(actual) > Number(it.requested_quantity) + tol + 1e-9) throw new Error('OVER_ENVELOPE');
      // Single-statement attempt at `actual`; on predicate failure fall back to max-fulfillable
      // (always ≤ attempted). The tolerance gate above already ran — this is the STOCK gate (R7).
      let eff = String(actual), capped = false;
      let u = await q(`UPDATE inventory SET quantity = quantity - $2, reserved_quantity = reserved_quantity - $3
        WHERE product_variant_id=$1 AND (quantity - reserved_quantity + $3) >= $2
        RETURNING quantity::text nq`, [it.product_variant_id, actual, it.requested_quantity]);
      if (!u.rows.length) {
        const cap = await q(`SELECT (quantity - reserved_quantity + $2)::text m FROM inventory WHERE product_variant_id=$1`,
          [it.product_variant_id, it.requested_quantity]);
        const m = Number(cap.rows[0].m);
        if (!(m > 0)) {
          await q(`UPDATE order_items SET item_status='UNAVAILABLE' WHERE id=$1`, [itemId]);
          await q('COMMIT'); return { ok: true, capped: true, committed: '0', status: 'UNAVAILABLE' };
        }
        eff = m.toFixed(3); capped = true;
        u = await q(`UPDATE inventory SET quantity = quantity - $2, reserved_quantity = reserved_quantity - $3
          WHERE product_variant_id=$1 AND (quantity - reserved_quantity + $3) >= $2
          RETURNING quantity::text nq`, [it.product_variant_id, eff, it.requested_quantity]);
        if (!u.rows.length) throw new Error('CAP_RACE');
      }
      const newQ = u.rows[0].nq;
      const prevQ = (Number(newQ) + Number(eff)).toFixed(3);
      const delta = (-Number(eff)).toFixed(3); // SALE decrements on-hand: SIGNED delta (Phase 1 ledger rule)
      await q(`INSERT INTO inventory_movements (product_variant_id, movement_type, quantity, previous_quantity,
        new_quantity, reference_type, reference_id, reason) VALUES ($1,'SALE',$2,$3,$4,'ORDER',$5,$6)`,
        [it.product_variant_id, delta, prevQ, newQ, it.order_id, note || (capped ? 'stock-shortage cap' : 'picking commit')]);
      const fin = (Math.round(Number(eff) * Number(it.unit_price) * 100) / 100).toFixed(2);
      // R7: shortfall vs requested → PARTIALLY; equal-or-tolerance-over → FULFILLED (actual recorded)
      const st = Number(eff) < Number(it.requested_quantity) - 1e-9 ? 'PARTIALLY_FULFILLED' : 'FULFILLED';
      await q(`UPDATE order_items SET actual_quantity=$2, final_total=$3, item_status=$4 WHERE id=$1`,
        [itemId, eff, fin, st]);
      await refreshFinals(it.order_id);
      await q('COMMIT');
      return { ok: true, capped, committed: eff, status: st, final: fin };
    } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
  }
  async function refreshFinals(orderId) {
    const s = await q(`SELECT COALESCE(SUM(final_total),0)::text t, COUNT(*) FILTER (WHERE item_status='PENDING')::int p,
      COUNT(*) FILTER (WHERE item_status IN ('FULFILLED','PARTIALLY_FULFILLED'))::int e
      FROM order_items WHERE order_id=$1`, [orderId]);
    if (Number(s.rows[0].p) === 0 && Number(s.rows[0].e) > 0) {
      await q(`UPDATE orders SET subtotal_final=$2, total_final = $2 - LEAST(discount_total, $2) + delivery_fee WHERE id=$1`,
        [orderId, s.rows[0].t]);
    } else if (Number(s.rows[0].e) > 0) {
      await q(`UPDATE orders SET subtotal_final=$2 WHERE id=$1`, [orderId, s.rows[0].t]);
    }
  }

  // ---- reference replacement propose/approve (frozen R10) ----
  async function propose(itemId, repVariant, repQty, reason, byType = 'STAFF', byId = STAFF) {
    await q('BEGIN');
    try {
      const it = (await q('SELECT * FROM order_items WHERE id=$1 FOR UPDATE', [itemId])).rows[0];
      if (!it || it.item_status !== 'PENDING') throw new Error('BAD_ITEM_STATE');
      await q(`UPDATE order_items SET item_status='UNAVAILABLE' WHERE id=$1`, [itemId]); // OOS-driven
      const vp = (await q('SELECT price::text p FROM product_variants WHERE id=$1', [repVariant])).rows[0];
      const origEst = Number(it.requested_quantity) * Number(it.unit_price);
      const diff = (Math.round((Number(repQty) * Number(vp.p) - origEst) * 100) / 100).toFixed(2);
      const r = await q(`INSERT INTO order_item_replacements (order_item_id, replacement_variant_id,
        replacement_quantity, replacement_unit_price, price_difference, reason, proposed_by_type, proposed_by_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [itemId, repVariant, repQty, vp.p, diff, reason, byType, byId]);
      await q('COMMIT');
      return { ok: true, repId: r.rows[0].id, diff };
    } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
  }
  async function approve(repId, deciderType, deciderId) {
    await q('BEGIN');
    try {
      const r = (await q('SELECT * FROM order_item_replacements WHERE id=$1 FOR UPDATE', [repId])).rows[0];
      if (!r) throw new Error('NO_REP');
      if (r.status !== 'PROPOSED') { await q('ROLLBACK'); return { ok: false, reason: 'NOT_PROPOSED' }; }
      const orig = (await q('SELECT * FROM order_items WHERE id=$1 FOR UPDATE', [r.order_item_id])).rows[0];
      const rv = await q(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2
        WHERE product_variant_id=$1 AND (quantity - reserved_quantity) >= $2 RETURNING 1`,
        [r.replacement_variant_id, r.replacement_quantity]);
      if (!rv.rows.length) throw new Error('SUBSTITUTE_SHORT');
      const v = (await q(`SELECT v.name vn, v.size_unit su, p.name pn, p.product_type pt, p.sale_step_grams ss, b.name bn
        FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN brands b ON b.id=p.brand_id
        WHERE v.id=$1`, [r.replacement_variant_id])).rows[0];
      const code = (await q(`SELECT code, type FROM product_codes WHERE product_variant_id=$1 AND is_primary`,
        [r.replacement_variant_id])).rows[0];
      const lineUnit = v.pt === 'WEIGHT' ? v.su : 'PIECE'; // counting-unit rule (see checkout)
      const est = (Math.round(Number(r.replacement_quantity) * Number(r.replacement_unit_price) * 100) / 100).toFixed(2);
      const nl = await q(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot,
        variant_name_snapshot, brand_name_snapshot, product_code_snapshot, code_type_snapshot, unit_snapshot,
        product_type_snapshot, sale_step_snapshot, unit_price, requested_quantity, estimated_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [orig.order_id, r.replacement_variant_id, v.pn, v.vn, v.bn, code ? code.code : null, code ? code.type : null,
          lineUnit, v.pt, v.ss, Number(r.replacement_unit_price).toFixed(2), r.replacement_quantity, est]);
      await q(`UPDATE order_item_replacements SET status=$2, decided_by_type=$3, decided_by_id=$4,
        replacement_order_item_id=$5 WHERE id=$1`,
        [repId, deciderType === 'AUTO' ? 'AUTO_ACCEPTED' : 'CUSTOMER_APPROVED', deciderType === 'AUTO' ? 'SYSTEM' : deciderType,
          deciderType === 'AUTO' ? null : deciderId, nl.rows[0].id]);
      await q(`UPDATE order_items SET item_status='REPLACED' WHERE id=$1`, [orig.id]);
      await q(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id=$1`,
        [orig.product_variant_id, orig.requested_quantity]);
      await refreshFinals(orig.order_id);
      await q('COMMIT');
      return { ok: true, newLine: nl.rows[0].id };
    } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
  }

  // ============================ TESTS ============================
  try {
    // ---- Customers ----
    await mkCustomer(uid(4101), normalizePhone('01000000001')); ok('C1 guest insert (010… normalized)');
    await expectReject('C2 duplicate canonical rejected', () =>
      mkCustomer(uid(4102), normalizePhone('+201000000001')), 'duplicate');
    for (const [n, raw] of [['C3a letters', 'abc123'], ['C3b spaces', '01 0123 45'], ['C3c short', '123'], ['C3d empty', '']])
      await expectReject(n, () => mkCustomer(uid(4200 + Math.floor(Math.random() * 90)), raw), null);
    await expectReject('C4 registered w/o hash rejected', () =>
      mkCustomer(uid(4103), normalizePhone('01099999999'), { hash: null, email: null }).then(() =>
        q(`UPDATE customers SET is_registered=TRUE WHERE id=$1`, [uid(4103)])), 'chk_customers_registered');
    await mkCustomer(uid(4104), normalizePhone('01122223333'), { hash: 'h$test', email: 'a@x.com' }); ok('C5 registered ok');
    await expectReject('C6 email dup rejected', () =>
      mkCustomer(uid(4105), normalizePhone('01233334444'), { hash: 'h', email: 'a@x.com' }), 'uq_customers_email');
    await mkCustomer(uid(4106), normalizePhone('01544445555'), { hash: 'h' });
    await mkCustomer(uid(4107), normalizePhone('01055556666')); ok('C6b two NULL emails coexist');
    await expectReject('C7 delete-while-active rejected', () =>
      q(`UPDATE customers SET deleted_at=now() WHERE id=$1`, [uid(4101)]), 'chk_customers_deleted_consistency');
    await q(`UPDATE customers SET is_active=FALSE, deleted_at=now() WHERE id=$1`, [uid(4101)]); ok('C7b soft delete ok');

    // ---- Addresses ----
    await mkAddr(uid(4111), uid(4104), true); ok('A0 first default ok');
    await expectReject('A1 second default rejected', () => mkAddr(uid(4112), uid(4104), true), 'uq_addresses_one_default');
    await q('BEGIN');
    await q(`UPDATE customer_addresses SET is_default=FALSE WHERE id=$1`, [uid(4111)]);
    await mkAddr(uid(4112), uid(4104), true);
    await q('COMMIT'); ok('A2 default switch in tx');
    await q(`DELETE FROM customer_addresses WHERE id=$1`, [uid(4112)]); ok('A3 hard delete allowed');

    // ---- Carts ----
    await mkCart(uid(4121), { s: 'sess-A' }); ok('K1 guest cart ok');
    await expectReject('K2 both-null rejected', () => q(`INSERT INTO carts (id) VALUES ($1)`, [uid(4122)]), 'chk_carts_ownership');
    await expectReject('K3 both-set rejected (XOR)', () =>
      q(`INSERT INTO carts (id, customer_id, session_id) VALUES ($1,$2,'x')`, [uid(4123), uid(4104)]), 'chk_carts_ownership');
    await mkCart(uid(4124), { c: uid(4104) }); ok('K4a customer cart ok');
    await expectReject('K4b second ACTIVE same customer rejected', () => mkCart(uid(4125), { c: uid(4104) }), 'uq_carts_active_customer');
    await expectReject('K5 second ACTIVE same session rejected', () => mkCart(uid(4126), { s: 'sess-A' }), 'uq_carts_active_session');
    await q(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [uid(4124)]);
    await mkCart(uid(4127), { c: uid(4104) }); ok('K6 new ACTIVE after checkout ok');

    // ---- Cart items ----
    await mkLine(uid(4131), uid(4127), P330, 2, 'PIECE', 15); ok('I0 line ok');
    await expectReject('I1 dup (cart,variant) rejected', () => mkLine(uid(4132), uid(4127), P330, 1, 'PIECE', 15), 'uq_cart_items_line');
    await expectReject('I2 zero qty rejected', () => mkLine(uid(4133), uid(4127), P1L, 0, 'PIECE', 30), 'chk_cart_items_qty');
    await expectReject('I3 bad unit rejected', () => mkLine(uid(4134), uid(4127), P1L, 1, 'OUNCE', 30), 'chk_cart_items_unit');
    await mkCart(uid(4135), { s: 'sess-unit-x' });
    await mkLine(uid(4136), uid(4135), P330, 1, 'KG', 15); // valid domain, wrong counting unit
    const coUX = await checkout({ cartId: uid(4135), customerId: uid(4104), addressId: uid(4111), key: 'unit-x-key' });
    (!coUX.ok && String(coUX.reason).startsWith('UNIT_CHANGED'))
      ? ok('I4 unit mismatch aborts at checkout (no silent KG→pack conversion)') : bad('I4 unit mismatch', JSON.stringify(coUX));

    // ---- Checkout ----
    await mkCustomer(uid(4141), normalizePhone('01077778888'));
    await mkAddr(uid(4142), uid(4141), true);
    await mkCart(uid(4143), { c: uid(4141) });
    await mkLine(uid(4144), uid(4143), P330, 2, 'PIECE', 15);
    await mkLine(uid(4145), uid(4143), P1L, 1, 'PIECE', 30);
    const co1 = await checkout({ cartId: uid(4143), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-001' });
    co1.ok ? ok('O1 checkout success') : bad('O1 checkout success', co1.reason);
    await assertInv('O1 reserved 2×330 + 1×1L', P330, '500.000', '2.000', '498.000');
    const mv1 = await q(`SELECT COUNT(*) c FROM inventory_movements WHERE reference_id=$1`, [co1.orderId]);
    (mv1.rows[0].c == 0) ? ok('O1b no movements on reserve') : bad('O1b no movements on reserve', mv1.rows[0].c);
    const h1 = await q(`SELECT old_status o, new_status n FROM order_status_history WHERE order_id=$1`, [co1.orderId]);
    const hset = new Set(h1.rows.map(r => r.o + '>' + r.n));
    // intra-tx now() ties make row order nondeterministic — assert as a set
    (hset.has('null>NEW') && hset.has('NEW>CONFIRMED') && h1.rows.length === 2) ? ok('O1c history NULL→NEW→CONFIRMED') : bad('O1c history', JSON.stringify(h1.rows));
    const t1 = await q(`SELECT subtotal_estimated::text s, total_estimated::text t FROM orders WHERE id=$1`, [co1.orderId]);
    (t1.rows[0].s === '60.00' && t1.rows[0].t === '80.00') ? ok('O1d totals 60/80 (fee 20)') : bad('O1d totals', JSON.stringify(t1.rows[0]));

    // price drift
    await q(`UPDATE product_variants SET price=17.00 WHERE id=$1`, [P330]);
    await q(`INSERT INTO product_price_history (product_variant_id, old_price, new_price, reason) VALUES ($1,15,17,'test')`, [P330]);
    await mkCart(uid(4146), { c: uid(4141) });
    await mkLine(uid(4147), uid(4146), P330, 1, 'PIECE', 15);
    const co2 = await checkout({ cartId: uid(4146), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-002' });
    (!co2.ok && co2.reason === 'PRICE_CHANGED') ? ok('O2 price drift detected, checkout blocked') : bad('O2 price drift', JSON.stringify(co2));
    const co2b = await checkout({ cartId: uid(4146), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-002b', confirmPrices: true });
    co2b.ok ? ok('O2b confirmed new terms succeed') : bad('O2b confirmed terms', co2b.reason);
    await q(`UPDATE product_variants SET price=15.00 WHERE id=$1`, [P330]);
    await q(`INSERT INTO product_price_history (product_variant_id, old_price, new_price, reason) VALUES ($1,17,15,'test revert')`, [P330]);

    // insufficient + oversell
    await mkCart(uid(4148), { c: uid(4141) });
    await mkLine(uid(4149), uid(4148), P25L, 1000, 'PIECE', 55);
    const co3 = await checkout({ cartId: uid(4148), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-003' });
    (!co3.ok && String(co3.reason).startsWith('INSUFFICIENT')) ? ok('O3 insufficient rolls back') : bad('O3 insufficient', JSON.stringify(co3));
    const noOrd = await q(`SELECT COUNT(*) c FROM orders WHERE cart_id=$1`, [uid(4148)]);
    const inv25 = await inv(P25L);
    (noOrd.rows[0].c == 0 && inv25.r === '0.000') ? ok('O3b no order, no reservation leaked') : bad('O3b leak check');
    await q(`UPDATE carts SET status='ABANDONED' WHERE id=$1`, [uid(4148)]); // failed-checkout cart stays ACTIVE; retire it
    await mkCart(uid(4150), { c: uid(4141) });
    await mkLine(uid(4151), uid(4150), P25L, 150, 'PIECE', 55);
    const co4a = await checkout({ cartId: uid(4150), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-004a' });
    await mkCart(uid(4152), { c: uid(4141) });
    await mkLine(uid(4153), uid(4152), P25L, 1, 'PIECE', 55);
    const co4b = await checkout({ cartId: uid(4152), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-004b' });
    (co4a.ok && !co4b.ok) ? ok('O4 oversell prevented (150 ok, +1 fails)') : bad('O4 oversell', JSON.stringify([co4a.ok, co4b]));
    await q(`UPDATE carts SET status='ABANDONED' WHERE id=$1`, [uid(4152)]); // retire failed-checkout cart

    // idempotency
    const co5 = await checkout({ cartId: uid(4143), customerId: uid(4141), addressId: uid(4142), key: 'idem-checkout-001' });
    (co5.ok && co5.replay && co5.orderId === co1.orderId) ? ok('O5 replay returns same order') : bad('O5 replay', JSON.stringify(co5));
    await expectReject('O5b raw dup key rejected', () =>
      q(`INSERT INTO orders (customer_id, order_number, idempotency_key, subtotal_estimated, total_estimated,
        customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_phone)
        VALUES ($1,'HM-20260101-999999','idem-checkout-001',0,0,'x','201000000000','Cairo','201000000000')`, [uid(4141)]), 'duplicate');

    // ---- Weighted commits (R7) ----
    await mkCustomer(uid(4161), normalizePhone('01088889999'));
    await mkAddr(uid(4162), uid(4161), true);
    async function weightOrder(qty, key, n) {
      await mkCart(uid(4300 + n * 10), { c: uid(4161) });
      await mkLine(uid(4301 + n * 10), uid(4300 + n * 10), ROMI_V, qty, 'KG', 320);
      const co = await checkout({ cartId: uid(4300 + n * 10), customerId: uid(4161), addressId: uid(4162), key, fee: 0 });
      if (!co.ok) throw new Error('checkout failed: ' + co.reason);
      await advance(co.orderId, 'CONFIRMED', 'PREPARING');
      const it = (await q(`SELECT id FROM order_items WHERE order_id=$1`, [co.orderId])).rows[0].id;
      return { orderId: co.orderId, itemId: it };
    }
    let w = await weightOrder(0.5, 'w-key-1', 1);
    let r = await commitPick(w.itemId, '0.475');
    (r.ok && r.status === 'PARTIALLY_FULFILLED' && r.final === '152.00')
      ? ok('W1 under 0.500→0.475 PARTIAL 152.00') : bad('W1', JSON.stringify(r));
    await assertInv('W1 inventory 46.875/0/46.875', ROMI_V, '46.875', '0.000', '46.875');
    const m1 = await q(`SELECT quantity::text d, previous_quantity::text p, new_quantity::text n, movement_type t
      FROM inventory_movements WHERE product_variant_id=$1 ORDER BY created_at DESC LIMIT 1`, [ROMI_V]);
    (m1.rows[0].d === '-0.475' && m1.rows[0].p === '47.350' && m1.rows[0].n === '46.875' && m1.rows[0].t === 'SALE')
      ? ok('W1b SALE(-0.475 signed delta, 47.350→46.875)') : bad('W1b movement', JSON.stringify(m1.rows[0]));
    w = await weightOrder(0.5, 'w-key-2', 2);
    r = await commitPick(w.itemId, '0.500');
    (r.ok && r.status === 'FULFILLED' && r.final === '160.00') ? ok('W2 exact 0.5→0.5 FULFILLED 160.00') : bad('W2', JSON.stringify(r));
    w = await weightOrder(0.5, 'w-key-3', 3);
    r = await commitPick(w.itemId, '0.525');
    (r.ok && r.status === 'FULFILLED' && r.final === '168.00') ? ok('W3 tolerance-over 0.525 FULFILLED 168.00') : bad('W3', JSON.stringify(r));
    w = await weightOrder(0.5, 'w-key-4', 4);
    r = await commitPick(w.itemId, '0.650');
    (!r.ok && r.reason === 'OVER_ENVELOPE') ? ok('W4 out-of-tolerance 0.650 rejected, no writes') : bad('W4', JSON.stringify(r));
    const st4 = await q(`SELECT item_status s, actual_quantity a FROM order_items WHERE id=$1`, [w.itemId]);
    (st4.rows[0].s === 'PENDING' && st4.rows[0].a === null) ? ok('W4b item still PENDING/NULL') : bad('W4b state', JSON.stringify(st4.rows[0]));
    // drain others to q=0.500 (W4's hold is still reserved: commit it exact first)
    const w4c = await commitPick(w.itemId, '0.500');
    if (!w4c.ok || w4c.status !== 'FULFILLED') throw new Error('W4 cleanup commit failed: ' + JSON.stringify(w4c));
    await q(`UPDATE inventory SET quantity=0.500 WHERE product_variant_id=$1`, [ROMI_V]);
    await q(`INSERT INTO inventory_movements (product_variant_id, movement_type, quantity, previous_quantity,
      new_quantity, reference_type, reference_id, reason) VALUES ($1,'ADJUSTMENT',-44.850,45.350,0.500,'MANUAL','test-drain','W5 setup')`, [ROMI_V]);
    w = await weightOrder(0.5, 'w-key-5', 5);
    r = await commitPick(w.itemId, '0.600');
    (r.ok && r.capped && r.committed === '0.500' && r.status === 'FULFILLED')
      ? ok('W5 stock-shortage cap 0.600→0.500 FULFILLED') : bad('W5', JSON.stringify(r));
    await assertInv('W5 inventory 0/0/0', ROMI_V, '0.000', '0.000', '0.000');
    const w6 = await (async () => {
      await mkCart(uid(4400), { c: uid(4161) });
      await mkLine(uid(4401), uid(4400), P330, 10, 'PIECE', 15);
      const co = await checkout({ cartId: uid(4400), customerId: uid(4161), addressId: uid(4162), key: 'w-key-6', fee: 0 });
      await advance(co.orderId, 'CONFIRMED', 'PREPARING');
      return (await q(`SELECT id FROM order_items WHERE order_id=$1`, [co.orderId])).rows[0].id;
    })();
    const r6 = await commitPick(w6, '11');
    (!r6.ok && r6.reason === 'OVER_ENVELOPE') ? ok('W6 PIECE 10→11 rejected (tolerance 0)') : bad('W6', JSON.stringify(r6));
    // rounding edge (step-valid): 0.125 KG × 333.33 = 41.66625 → 41.67, CHECK-verified
    await q(`UPDATE product_variants SET price=333.33 WHERE id=$1`, [ROMI_V]);
    await q(`INSERT INTO product_price_history (product_variant_id, old_price, new_price, reason) VALUES ($1,320,333.33,'W7 setup')`, [ROMI_V]);
    await q(`UPDATE carts SET status='ABANDONED' WHERE id=$1`, [uid(4410)]); // retire step-rejected cart
    await q(`UPDATE inventory SET quantity=10.000 WHERE product_variant_id=$1`, [ROMI_V]); // restock (was 0 after W5)
    await q(`INSERT INTO inventory_movements (product_variant_id, movement_type, quantity, previous_quantity,
      new_quantity, reference_type, reference_id, reason)
      VALUES ($1,'STOCK_IN',10.000,0.000,10.000,'PURCHASE','PO-W7','W7 restock')`, [ROMI_V]);
    await mkCart(uid(4412), { c: uid(4161) });
    await mkLine(uid(4413), uid(4412), ROMI_V, 0.125, 'KG', 333.33);
    const co7 = await checkout({ cartId: uid(4412), customerId: uid(4161), addressId: uid(4162), key: 'w-key-7', fee: 0 });
    const e7 = co7.ok ? (await q(`SELECT estimated_total::text e FROM order_items WHERE order_id=$1`, [co7.orderId])).rows[0].e : null;
    (co7.ok && e7 === '41.67') ? ok('W7 rounding 0.125×333.33=41.67 CHECK-verified') : bad('W7', JSON.stringify({ co7, e7 }));
    await q(`UPDATE product_variants SET price=320.00 WHERE id=$1`, [ROMI_V]);
    await q(`INSERT INTO product_price_history (product_variant_id, old_price, new_price, reason) VALUES ($1,333.33,320,'W7 revert')`, [ROMI_V]);

    // ---- Replacements (R10) ----
    const oi = (await q(`SELECT id FROM order_items WHERE order_id=$1`, [co1.orderId])).rows.find(() => true);
    const line330 = (await q(`SELECT oi.id FROM order_items oi JOIN product_variants v ON v.id=oi.product_variant_id
      WHERE oi.order_id=$1 AND v.name='330 ML'`, [co1.orderId])).rows[0].id;
    await advance(co1.orderId, 'CONFIRMED', 'PREPARING');
    const pr = await propose(line330, P1L, 1, '330ML OOS');
    pr.ok ? ok('R1 propose ok (diff ' + pr.diff + ')') : bad('R1 propose', pr.reason);
    const dup2 = await propose(line330, P1L, 1, 'dup');
    (!dup2.ok) ? ok('R2 second PROPOSED rejected (partial UQ)') : bad('R2 second PROPOSED', 'succeeded');
    const ap = await approve(pr.repId, 'CUSTOMER', uid(4141));
    ap.ok ? ok('R3 approve materialized') : bad('R3 approve', ap.reason);
    const fin = await q(`SELECT subtotal_final::text s, total_final::text t FROM orders WHERE id=$1`, [co1.orderId]);
    // finals: original 330-line REPLACED (excluded); 1L line still PENDING → finals stay NULL
    (fin.rows[0].s === null && fin.rows[0].t === null)
      ? ok('R3b finals NULL while a line still PENDING') : bad('R3b finals', JSON.stringify(fin.rows[0]));
    const excl = await q(`SELECT item_status s FROM order_items WHERE id=$1`, [line330]);
    const incl = await q(`SELECT requested_quantity::text q, estimated_total::text e FROM order_items WHERE id=$1`, [ap.newLine]);
    (excl.rows[0].s === 'REPLACED' && incl.rows[0].q === '1.000' && incl.rows[0].e === '30.00')
      ? ok('R3c original REPLACED, new line 1×30.00') : bad('R3c lines', JSON.stringify([excl.rows[0], incl.rows[0]]));
    // approve-fail: substitute Romi has 10.000? use qty beyond stock: P25L fully reserved (150/150)
    const line1L = (await q(`SELECT oi.id FROM order_items oi WHERE oi.order_id=$1 AND oi.product_variant_id=$2`, [co1.orderId, P1L])).rows[0].id;
    const pr2 = await propose(line1L, P25L, 5, 'need 5×2.5L');
    const ap2 = await approve(pr2.repId, 'CUSTOMER', uid(4141));
    (!ap2.ok && ap2.reason === 'SUBSTITUTE_SHORT') ? ok('R4 approve-fail rolls back') : bad('R4', JSON.stringify(ap2));
    const st2 = await q(`SELECT status s, replacement_order_item_id l FROM order_item_replacements WHERE id=$1`, [pr2.repId]);
    (st2.rows[0].s === 'PROPOSED' && st2.rows[0].l === null) ? ok('R4b remains PROPOSED, no line') : bad('R4b state', JSON.stringify(st2.rows[0]));
    const inv25b = await inv(P25L);
    (inv25b.r === '150.000') ? ok('R4c no hold leaked on substitute') : bad('R4c leak', JSON.stringify(inv25b));
    await q(`UPDATE order_item_replacements SET status='CUSTOMER_REJECTED', decided_by_type='CUSTOMER', decided_by_id=$2 WHERE id=$1`, [pr2.repId, uid(4141)]);
    ok('R5 reject path ok');
    // transition trigger isolation: APPROVED (R3) -> PROPOSED must die in the TRIGGER (CHECKs would pass the pair test aside)
    await expectReject('R6 APPROVED→PROPOSED rejected', () =>
      q(`UPDATE order_item_replacements SET status='PROPOSED' WHERE id=$1`, [pr.repId]), 'Invalid replacement transition');
    // withdrawal = REJECTED by STAFF from PROPOSED
    const pr3 = await propose(line1L, P1L, 1, 'withdraw test');
    await q(`UPDATE order_item_replacements SET status='CUSTOMER_REJECTED', decided_by_type='STAFF', decided_by_id=$2
      WHERE id=$1`, [pr3.repId, STAFF]);
    ok('R7 staff withdrawal via REJECTED ok');

    // ---- Transitions & audit trigger ----
    await expectReject('T1 illegal history NEW→DELIVERED rejected', () =>
      hist(co1.orderId, 'NEW', 'DELIVERED', 'STAFF', STAFF), 'chk_history_transition');
    await expectReject('T2 item FULFILLED→PENDING rejected', async () => {
      const f = (await q(`SELECT id FROM order_items WHERE item_status='FULFILLED' LIMIT 1`)).rows[0];
      await q(`UPDATE order_items SET item_status='PENDING', actual_quantity=NULL WHERE id=$1`, [f.id]);
    }, 'Invalid order item transition');
    await expectReject('T3 cart CHECKED_OUT→ACTIVE rejected', () =>
      q(`UPDATE carts SET status='ACTIVE' WHERE id=$1`, [uid(4143)]), 'terminal');
    // current status is PREPARING (advanced above) → jump attempt without history must die in trigger
    await expectReject('T4 status w/o history rejected', () =>
      q(`UPDATE orders SET status='OUT_FOR_DELIVERY' WHERE id=$1`, [co1.orderId]), 'no matching history row');
    await hist(co1.orderId, 'PREPARING', 'READY_FOR_DELIVERY', 'STAFF', STAFF).catch(() => {});
    await hist(co1.orderId, 'PREPARING', 'READY_FOR_DELIVERY', 'STAFF', STAFF).then(
      () => q(`UPDATE orders SET status='READY_FOR_DELIVERY' WHERE id=$1`, [co1.orderId])).then(() => ok('T5 history-first status update ok'), (e) => bad('T5', e.message));

    // ---- Merge (R1 algorithm reference) ----
    async function mergeGuest(guestCart, customerId) {
      await q('BEGIN');
      try {
        const ids = [guestCart];
        const cust = (await q(`SELECT id FROM carts WHERE customer_id=$1 AND status='ACTIVE' FOR UPDATE`, [customerId])).rows[0];
        if (cust) ids.push(cust.id);
        ids.sort();
        for (const id of ids) await q(`SELECT * FROM carts WHERE id=$1 FOR UPDATE`, [id]);
        const g = (await q(`SELECT * FROM carts WHERE id=$1`, [guestCart])).rows[0];
        if (!g || g.status !== 'ACTIVE' || g.customer_id) throw new Error('GUEST_GONE');
        const dropped = [];
        if (!cust) {
          await q(`UPDATE carts SET customer_id=$2, session_id=NULL, expires_at=NULL WHERE id=$1`, [guestCart, customerId]);
        } else {
          const lines = (await q(`SELECT * FROM cart_items WHERE cart_id=$1`, [guestCart])).rows;
          for (const l of lines) {
            const v = (await q(`SELECT price::text p, size_unit u, is_active a, deleted_at d FROM product_variants WHERE id=$1`,
              [l.product_variant_id])).rows[0];
            if (!v || !v.a || v.d) { dropped.push(l.id); continue; }
            await q(`INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
              VALUES ($1,$2,$3,$4,$5, now())
              ON CONFLICT (cart_id, product_variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity,
              unit_price_snapshot = EXCLUDED.unit_price_snapshot, price_checked_at = now()`,
              [cust.id, l.product_variant_id, l.quantity, v.u, v.p]);
          }
          await q(`UPDATE carts SET status='MERGED' WHERE id=$1`, [guestCart]);
        }
        await q('COMMIT');
        return { ok: true, dropped };
      } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
    }
    await mkCart(uid(4501), { s: 'sess-merge-1' });
    await mkLine(uid(4502), uid(4501), P330, 1, 'PIECE', 15);
    const m1r = await mergeGuest(uid(4501), uid(4161));
    const m1c = await q(`SELECT customer_id::text c, session_id s, status t FROM carts WHERE id=$1`, [uid(4501)]);
    // uid(4161) holds no ACTIVE cart (all checked out) → reassign path
    (m1r.ok && m1c.rows[0].c === uid(4161) && m1c.rows[0].s === null && m1c.rows[0].t === 'ACTIVE')
      ? ok('M1 reassign path (owner flipped, session nulled, stays ACTIVE)') : bad('M1', JSON.stringify([m1r, m1c.rows[0]]));
    // dead-variant drop: deactivate P1L, merge into 4141 which gets a fresh ACTIVE cart (sum path)
    await mkCart(uid(4503), { s: 'sess-merge-2' });
    await mkLine(uid(4504), uid(4503), P1L, 1, 'PIECE', 30);
    await q(`UPDATE product_variants SET is_active=FALSE WHERE id=$1`, [P1L]);
    await mkCart(uid(4505), { c: uid(4141) });
    const m2r = await mergeGuest(uid(4503), uid(4141));
    (m2r.ok && m2r.dropped && m2r.dropped.length === 1) ? ok('M2 dead variant dropped + reported') : bad('M2', JSON.stringify(m2r));
    await q(`UPDATE product_variants SET is_active=TRUE WHERE id=$1`, [P1L]);

    // ---- §29 invariant battery ----
    await assertInvariant('V1 inventory invariant all rows');
    const neg = await q(`SELECT COUNT(*) c FROM orders WHERE total_estimated < 0 OR total_final < 0
      OR subtotal_estimated < 0 OR subtotal_final < 0 OR discount_total < 0 OR delivery_fee < 0`);
    (neg.rows[0].c == 0) ? ok('V2 money non-negative') : bad('V2 money');
    const dbl = await q(`SELECT o.id, o.subtotal_final::text s,
      (SELECT COALESCE(SUM(final_total),0)::text FROM order_items
        WHERE order_id=o.id AND item_status IN ('FULFILLED','PARTIALLY_FULFILLED')) m
      FROM orders o WHERE o.subtotal_final IS NOT NULL`);
    const badTot = dbl.rows.filter(r => r.s !== r.m);
    (badTot.length === 0) ? ok('V3 no double-count (SUM over effective lines == stored)') : bad('V3 double-count', JSON.stringify(badTot));
    const multi = await q(`SELECT customer_id FROM carts WHERE status='ACTIVE' AND customer_id IS NOT NULL
      GROUP BY customer_id HAVING COUNT(*) > 1`);
    const multiS = await q(`SELECT session_id FROM carts WHERE status='ACTIVE' AND session_id IS NOT NULL
      GROUP BY session_id HAVING COUNT(*) > 1`);
    (multi.rows.length === 0 && multiS.rows.length === 0) ? ok('V4 single ACTIVE per owner') : bad('V4 multi-active');
    const idem = await q(`SELECT idempotency_key FROM orders WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1`);
    (idem.rows.length === 0) ? ok('V5 idempotency keys unique') : bad('V5 dup keys');
    const nochk = await q(`SELECT COUNT(*) c FROM carts WHERE customer_id IS NULL AND session_id IS NULL`);
    const bothk = await q(`SELECT COUNT(*) c FROM carts WHERE customer_id IS NOT NULL AND session_id IS NOT NULL`);
    (nochk.rows[0].c == 0 && bothk.rows[0].c == 0) ? ok('V6 XOR ownership holds') : bad('V6 ownership');
    // invoice render uses snapshots only (no live-catalog join needed)
    const inv2 = await q(`SELECT oi.product_name_snapshot, oi.variant_name_snapshot, oi.unit_price::text,
      oi.requested_quantity::text, oi.estimated_total::text, o.order_number, o.total_estimated::text
      FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=$1`, [co1.orderId]);
    (inv2.rows.length >= 2 && inv2.rows[0].product_name_snapshot) ? ok('V7 history renders from snapshots only') : bad('V7 render');

    console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) { console.log('HARNESS ERROR: ' + e.message); process.exitCode = 1; }
})();
