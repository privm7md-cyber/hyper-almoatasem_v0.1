// PHASE 4 functional suite — real PostgreSQL (PGlite) on SHIPPED files.
// TEST-ENV SHIMS ONLY (never shipped): pgcrypto line neutralised in-memory + stub
// gen_random_uuid(); all tests send explicit UUIDs. Shipped bytes untouched.
// Reference promotion engine below is a TEST DOUBLE of frozen rules — not product code.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const DBDIR = path.join(__dirname, '..');

const ROMI_V = '01800000-0000-7000-8000-000000000101'; // KG 320 step125, product ...100
const P330 = '01800000-0000-7000-8000-000000000201';   // 15.00, product ...200, brand ...010
const P1L = '01800000-0000-7000-8000-000000000202';    // 30.00
const P25L = '01800000-0000-7000-8000-000000000203';   // 55.00
const CAT_DAIRY = '01800000-0000-7000-8000-000000000001';
const BRAND_PEPSI = '01800000-0000-7000-8000-000000000010';
const PROD_PEPSI = '01800000-0000-7000-8000-000000000200';
const PROD_ROMI = '01800000-0000-7000-8000-000000000100';
let seq = 800000;
const uid = () => '01800000-0000-7000-8000-' + String(seq++).padStart(12, '0');
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS ' + n); };
const bad = (n, e) => { fail++; console.log('FAIL ' + n + ' :: ' + String(e && e.message || e).split('\n')[0]); };
const eq = (a, b) => String(a) === String(b);
const normCode = (raw) => String(raw).trim().toUpperCase().replace(/\s+/g, ' ');

(async () => {
  const db = new PGlite();
  const shimGen = `CREATE OR REPLACE FUNCTION gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$
    SELECT format('%s-%s-4%s-%s-%s', substr(m,1,8), substr(m,9,4), substr(m,13,3), substr(m,17,4), substr(m,21,12))::uuid
    FROM md5(random()::text || clock_timestamp()::text) AS m; $$;`;
  const load = async (f) => {
    let sql = fs.readFileSync(path.join(DBDIR, f), 'utf8');
    if (f === 'phase1-schema.sql') sql = sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',
      '-- [TEST SHIM] pgcrypto unavailable in PGlite');
    await db.exec(sql);
  };
  const q = (s, p) => db.query(s, p);
  await db.exec(shimGen);
  for (const f of ['phase1-schema.sql', 'phase1-seed-example.sql', 'phase2-schema.sql',
    'phase2-seed-example.sql', 'phase4-schema.sql', 'phase4-seed-example.sql']) await load(f);
  ok('SETUP phase1+2+4 shipped files load');

  // ---------- catalog snapshot for matching ----------
  const CAT = {};
  for (const r of (await q('SELECT id::text i, parent_id::text p FROM categories')).rows) CAT[r.i] = r.p;
  const inSubtree = (catId, rootId) => { let c = catId; while (c) { if (c === rootId) return true; c = CAT[c]; } return false; };
  const lineCtx = async (variantId) => (await q(`SELECT v.id::text vid, v.price::text price, v.size_unit su,
    v.is_active va, v.deleted_at vd, p.id::text pid, p.product_type pt, p.unit pu, p.sale_step_grams ss,
    p.brand_id::text bid, p.category_id::text cid, p.is_active pa, p.deleted_at pd
    FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=$1`, [variantId])).rows[0];

  // ---------- reference engine (frozen rules) ----------
  async function loadPromos(promoIds) {
    const pr = (await q(`SELECT *, discount_percent::text dp, discount_amount::text da, fixed_price::text fp,
      maximum_discount::text md, minimum_quantity::text mq, minimum_amount::text ma,
      buy_quantity::text bq, get_quantity::text gq, buy_pct::text bp, free_vid::text fv
      FROM (SELECT p.*, r.minimum_quantity, r.minimum_amount, r.maximum_discount,
        b.buy_quantity, b.get_quantity, b.discount_percent AS buy_pct, b.free_variant_id AS free_vid
        FROM promotions p LEFT JOIN promotion_rules r ON r.promotion_id=p.id
        LEFT JOIN promotion_buy_get_rules b ON b.promotion_id=p.id) x`)).rows;
    const list = promoIds ? pr.filter(r => promoIds.includes(r.id)) : pr;
    for (const p of list) p.targets = (await q(`SELECT target_type tt, target_id::text tid FROM promotion_targets WHERE promotion_id=$1`, [p.id])).rows;
    return list;
  }
  const effective = (p, now) => p.status === 'ACTIVE'
    && (!p.start_at || new Date(p.start_at) <= now) && (!p.end_at || new Date(p.end_at) > now);
  const SPEC = { VARIANT: 4, PRODUCT: 3, BRAND: 2, CATEGORY: 1 };
  function matchLine(line, promo) {
    let best = 0;
    for (const t of promo.targets) {
      let hit = false;
      if (t.tt === 'VARIANT' && t.tid === line.vid) hit = true;
      if (t.tt === 'PRODUCT' && t.tid === line.pid) hit = true;
      if (t.tt === 'BRAND' && line.bid && t.tid === line.bid) hit = true;
      if (t.tt === 'CATEGORY' && inSubtree(line.cid, t.tid)) hit = true;
      if (hit) best = Math.max(best, SPEC[t.tt]);
    }
    return best; // 0 = no match
  }
  const gramsOf = (line, qty) => line.pu === 'KG' ? Number(qty) * 1000 : line.su === 'KG' ? Number(qty) * 1000 : Number(qty);
  // evaluate(lineSet, promos, couponRow?) -> {rows:[{promo,kind,itemIdx,base,amount,snap}], couponAmt, allocBase}
  // lineSet: [{key, ctx, qty, gross}] ; amounts as Numbers rounded to 2 at each line step
  const R2 = (x) => Math.round(Number(x) * 100) / 100;
  function evaluate(lines, promos, now) {
    const out = [];
    const capUsed = {};
    const accepted = lines.map(() => []); // promo ids accepted per line
    const live = promos.filter(p => p.scope === 'LINE' && effective(p, now));
    // thresholds per promo over ALL its eligible lines
    for (const p of live) {
      let sumQ = 0, sumG = 0, elig = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!matchLine(lines[i].ctx, p)) continue;
        elig++;
        sumQ += lines[i].ctx.pt === 'WEIGHT' ? gramsOf(lines[i].ctx, lines[i].qty) : Number(lines[i].qty);
        sumG = R2(sumG + lines[i].gross);
      }
      p._ok = elig > 0
        && !(p.minimum_quantity != null && sumQ < Number(p.minimum_quantity) - 1e-9)
        && !(p.minimum_amount != null && sumG < Number(p.minimum_amount) - 1e-9);
      p._cap = p.maximum_discount != null ? Number(p.maximum_discount) : Infinity;
      capUsed[p.id] = 0;
    }
    // per-line candidate order: priority DESC, line-specificity DESC, created ASC
    const cands = lines.map((l) => {
      const arr = [];
      for (const p of live) { const spec = matchLine(l.ctx, p); if (spec) arr.push({ p, spec }); }
      arr.sort((a, b) => (b.p.priority - a.p.priority) || (b.spec - a.spec)
        || (a.p.created_at < b.p.created_at ? -1 : 1));
      return arr;
    });
    // apply in line-key order (deterministic cap accumulation) × per-line candidate order (stacking)
    const idx = lines.map((l, i) => i).sort((a, b) => String(lines[a].key) < String(lines[b].key) ? -1 : 1);
    for (const i of idx) {
      for (const { p, spec } of cands[i]) {
        if (!p._ok) continue;
        const acc = accepted[i];
        const gate = acc.length === 0 || (p.is_stackable && acc.every(a => a.stackable));
        if (!gate) continue;
        const base = lines[i].net; // sequential compounding on current net
        let amt = 0, freeQty = 0;
        if (p.type === 'PERCENTAGE') amt = R2(base * Number(p.discount_percent) / 100);
        else if (p.type === 'FIXED_AMOUNT') amt = Math.min(Number(p.discount_amount), base);
        else if (p.type === 'FIXED_PRICE') {
          const perUnit = Math.max(0, R2(lines[i].unitPrice - Number(p.fixed_price)));
          amt = R2(perUnit * Number(lines[i].qty));
          if (amt <= 0) continue; // skip-if-no-benefit
        } else if (p.type === 'BUY_X_GET_Y') {
          const sets = Math.floor(Number(lines[i].qty) / Number(p.buy_quantity) + 1e-9);
          if (sets <= 0) continue;
          freeQty = R2(sets * Number(p.get_quantity));
          if (p.free_vid) {
            // cross-variant free: NO buy-line discount; discount materializes on the
            // dedicated free line (A30 boundary). Record spec for the caller; skip gates/cap.
            out.push({ promo: p, kind: 'PROMOTION_LINE', itemIdx: i, base: lines[i].net,
              amount: 0, spec, freeQty, freeLine: { variant: p.free_vid, qty: freeQty } });
            continue;
          }
          // pct source: DB alias buy_pct, or discount_percent on synthetic fixtures
          const pct = p.buy_pct != null ? Number(p.buy_pct) : Number(p.discount_percent);
          amt = Math.min(R2(freeQty * Number(lines[i].unitPrice) * pct / 100), base);
        }
        const room = p._cap - capUsed[p.id];
        if (room <= 0) continue;
        if (amt > room) amt = R2(Math.floor(room * 100) / 100);
        if (amt <= 0) continue;
        capUsed[p.id] = R2(capUsed[p.id] + amt);
        lines[i].net = R2(base - amt);
        acc.push({ id: p.id, stackable: p.is_stackable });
        out.push({ promo: p, kind: 'PROMOTION_LINE', itemIdx: i, base, amount: amt, spec, freeQty });
      }
    }
    return { rows: out };
  }
  // order-layer: PURE (no mutation). Returns rows with eligible line indexes;
  // caller allocates with real item ids, reduces running nets, writes rows.
  function evaluateOrder(lines, promos, now) {
    const out = [];
    const grossAll = R2(lines.reduce((s, l) => s + l.gross, 0));
    const oautos = promos.filter(p => p.scope === 'ORDER' && effective(p, now))
      .sort((a, b) => (b.priority - a.priority) || (a.created_at < b.created_at ? -1 : 1));
    for (const p of oautos) {
      if (p.minimum_amount != null && grossAll < Number(p.minimum_amount) - 1e-9) continue;
      const elig = lines.map((l, i) => i).filter(i =>
        (p.targets || []).length === 0 || (lines[i].ctx && matchLine(lines[i].ctx, p) > 0));
      const base = R2(elig.reduce((s, i) => s + lines[i].net, 0));
      if (base <= 0) continue;
      let amt = p.type === 'PERCENTAGE' ? R2(base * Number(p.discount_percent) / 100)
        : Math.min(Number(p.discount_amount), base);
      const cap = p.maximum_discount != null ? Number(p.maximum_discount) : Infinity;
      amt = Math.min(amt, cap);
      if (amt <= 0) continue;
      out.push({ promo: p, kind: 'PROMOTION_ORDER', base, amount: amt, elig });
    }
    return { rows: out, grossAll };
  }
  // deterministic pro-rata allocation with largest remainder (dust by order_item_id order)
  function allocate(total, items) {
    // items: [{id, net}] ; returns [{id, amount}] summing EXACTLY to total
    const base = items.reduce((s, x) => s + x.net, 0);
    if (base <= 0 || total <= 0) return items.map(x => ({ id: x.id, amount: 0 }));
    let assigned = items.map(x => ({ id: x.id, raw: total * x.net / base, amount: 0 }));
    let sum = 0;
    for (const a of assigned) { a.amount = Math.floor(a.raw * 100) / 100; sum = R2(sum + a.amount); }
    let dust = Math.round((total - sum) * 100);
    const order = [...assigned].sort((a, b) => {
      const ra = a.raw * 100 - Math.floor(a.raw * 100), rb = b.raw * 100 - Math.floor(b.raw * 100);
      if (rb !== ra) return rb - ra;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    for (let k = 0; k < dust; k++) order[k % order.length].amount = R2(order[k % order.length].amount + 0.01);
    return assigned;
  }

  const mkLine = async (ctx, qty) => ({
    ctx, qty: String(qty),
    gross: R2(Number(qty) * Number(ctx.price)),
    net: R2(Number(qty) * Number(ctx.price)),
    unitPrice: Number(ctx.price), key: uid(),
  });

  try {
    // ================= CONSTRAINT TESTS =================
    await q(`INSERT INTO promotions (id, name, type, scope, status, priority) VALUES ($1,'x','PERCENTAGE','LINE','DRAFT',0)`, [uid()])
      .then(() => bad('P-C1 pct-null rejected', 'accepted')).catch((e) => /chk_promos_values/.test(e.message) ? ok('P-C1 pct-null rejected') : bad('P-C1', e));
    await q(`INSERT INTO promotions (id, name, type, scope, status, discount_percent, discount_amount, priority) VALUES ($1,'x','PERCENTAGE','LINE','DRAFT',10,5,0)`, [uid()])
      .then(() => bad('P-C2 pct+amt rejected', 'accepted')).catch((e) => /chk_promos_values/.test(e.message) ? ok('P-C2 pct+amt rejected') : bad('P-C2', e));
    await q(`INSERT INTO promotions (id, name, type, scope, status, fixed_price, priority) VALUES ($1,'x','FIXED_PRICE','ORDER','DRAFT',9,0)`, [uid()])
      .then(() => bad('P-C3 fixed-scope rejected', 'accepted')).catch((e) => /chk_promos_values|chk_promos_scope_types/.test(e.message) ? ok('P-C3 fixed-scope rejected') : bad('P-C3', e));
    await q(`INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority) VALUES ($1,'x','PERCENTAGE','LINE','DRAFT',150,0)`, [uid()])
      .then(() => bad('P-C4 pct>100 rejected', 'accepted')).catch((e) => /chk_promos_pct/.test(e.message) ? ok('P-C4 pct>100 rejected') : bad('P-C4', e));
    await q(`INSERT INTO promotions (id, name, type, scope, status, discount_amount, priority) VALUES ($1,'x','FIXED_AMOUNT','LINE','DRAFT',-5,0)`, [uid()])
      .then(() => bad('P-C5 neg amount rejected', 'accepted')).catch((e) => /chk_promos_amt/.test(e.message) ? ok('P-C5 neg amount rejected') : bad('P-C5', e));
    await q(`INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, start_at, end_at) VALUES ($1,'x','PERCENTAGE','LINE','DRAFT',10,0,now(),now())`, [uid()])
      .then(() => bad('P-C6 end<=start rejected', 'accepted')).catch((e) => /chk_promos_window/.test(e.message) ? ok('P-C6 end<=start rejected') : bad('P-C6', e));
    const bxg = (await q(`INSERT INTO promotions (id, name, type, scope, status, priority) VALUES ($1,'t-bxg','BUY_X_GET_Y','LINE','ACTIVE',0) RETURNING id`, [uid()])).rows[0].id;
    await q(`INSERT INTO promotion_buy_get_rules (promotion_id, buy_quantity, get_quantity, discount_percent) VALUES ($1,2,1,100)`, [bxg]);
    await q(`INSERT INTO promotion_buy_get_rules (promotion_id, buy_quantity, get_quantity, discount_percent) VALUES ($1,2,1,100)`, [bxg])
      .then(() => bad('P-C7 second bxgy row rejected', 'accepted')).catch((e) => /duplicate|uq|unique/i.test(e.message) ? ok('P-C7 second bxgy row rejected (1:1)') : bad('P-C7', e));
    await q(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ($1,'BRAND',$2)`, [bxg, BRAND_PEPSI]);
    await q(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ($1,'BRAND',$2)`, [bxg, BRAND_PEPSI])
      .then(() => bad('P-C8 dup target rejected', 'accepted')).catch((e) => /uq_promo_target|duplicate/i.test(e.message) ? ok('P-C8 dup target rejected') : bad('P-C8', e));
    await q(`INSERT INTO coupons (promotion_id, code) VALUES ($1,'  spaced code  ')`, [bxg])
      .then(() => bad('P-C9 raw code rejected', 'accepted')).catch((e) => /chk_coupons_code/.test(e.message) ? ok('P-C9 raw code rejected (format CHECK)') : bad('P-C9', e));
    const cp1 = (await q(`INSERT INTO coupons (id, promotion_id, code) VALUES ($1,$2,'TESTCODE1') RETURNING id`, [uid(), bxg])).rows[0].id;
    await q(`INSERT INTO coupons (promotion_id, code) VALUES ($1,'TESTCODE1')`, [bxg])
      .then(() => bad('P-C10 exact-case dup rejected', 'accepted')).catch((e) => /duplicate|unique/i.test(e.message) ? ok('P-C10 exact-case dup rejected (UQ normalized code)') : bad('P-C10', e));
    await q(`INSERT INTO coupons (id, promotion_id, code) VALUES ($1,$2,'testcode1')`, [uid(), bxg])
      .then(() => bad('P-C10b lowercase rejected', 'accepted')).catch((e) => /chk_coupons_code/.test(e.message) ? ok('P-C10b lowercase rejected (writer must normalize)') : bad('P-C10b', e));
    void cp1;

    // ================= TARGETING =================
    const now = new Date();
    const promos = await loadPromos();
    const effIds = promos.filter(p => effective(p, now)).map(p => p.id);
    (effIds.includes('01800000-0000-7000-8000-000000000601') && !effIds.includes('01800000-0000-7000-8000-000000000611'))
      ? ok('T1 effective = ACTIVE + in-window (P11 scheduled excluded)') : bad('T1 effective', effIds.join(','));
    const c330 = await lineCtx(P330), cRom = await lineCtx(ROMI_V), c1L = await lineCtx(P1L);
    const p1 = promos.find(p => p.id === '01800000-0000-7000-8000-000000000601');
    const p5 = promos.find(p => p.id === '01800000-0000-7000-8000-000000000605');
    const p10 = promos.find(p => p.id === '01800000-0000-7000-8000-000000000610');
    (matchLine(c330, p1) === 2 && matchLine(cRom, p1) === 0) ? ok('T2 brand target matches Pepsi, not Romi') : bad('T2 brand match');
    (matchLine(cRom, p5) === 4) ? ok('T3 variant target specificity=4') : bad('T3 variant');
    (matchLine(c330, p10) === 1 && matchLine(cRom, p10) === 1) ? ok('T4 category(dairy) matches both (subtree OR)') : bad('T4 category');
    // nested category subtree: captured id used directly (no alias roundtrip)
    const subId = uid();
    await q(`INSERT INTO categories (id, name, slug, parent_id) VALUES ($1,'Test Sub','test-sub',$2)`, [subId, CAT_DAIRY]);
    CAT[subId] = CAT_DAIRY; // refresh matching map (loaded at startup, before this insert)
    (inSubtree(subId, CAT_DAIRY) && !inSubtree(CAT_DAIRY, subId)) ? ok('T5 subtree helper (child in dairy, not reverse)') : bad('T5 subtree');
    const multi = { id: 'm', targets: [{ tt: 'BRAND', tid: BRAND_PEPSI }, { tt: 'CATEGORY', tid: CAT_DAIRY }] };
    (matchLine(c330, multi) === 2 && matchLine(cRom, multi) === 1) ? ok('T6 multi-target OR (best specificity wins)') : bad('T6 OR');

    // ================= PERCENTAGE =================
    const pct20 = { id: 't', type: 'PERCENTAGE', scope: 'LINE', status: 'ACTIVE', start_at: null, end_at: null, discount_percent: '20.00', priority: 10, is_stackable: false, created_at: new Date(0).toISOString(), targets: [{ tt: 'BRAND', tid: BRAND_PEPSI }] };
    let L = [await mkLine(c330, 2)]; // gross 30
    let r = evaluate(L, [pct20], now);
    (r.rows.length === 1 && eq(r.rows[0].amount, 6) && eq(L[0].net, 24)) ? ok('P20 20% of 30 = 6.00 net 24') : bad('P20', JSON.stringify([r.rows, L[0].net]));
    const pct125 = { ...pct20, id: 't2', discount_percent: '12.50' };
    L = [await mkLine(c330, 1)]; // 15 -> 1.875 -> 1.88
    r = evaluate(L, [pct125], now);
    (eq(r.rows[0].amount, 1.88)) ? ok('P12.5 decimal pct 15×12.5%=1.88') : bad('P12.5', JSON.stringify(r.rows));
    // cap: 20% max 100 on eligible 1000 -> build lines gross 1000
    const capP = { ...pct20, id: 't3', maximum_discount: '100.00', targets: [{ tt: 'PRODUCT', tid: PROD_PEPSI }] };
    L = [await mkLine(c330, 40), await mkLine(c1L, 40 / 2)]; // 600 + 600 = 1200? 40×15=600, 20×30=600
    L[0].key = 'a'; L[1].key = 'b';
    r = evaluate(L, [capP], now);
    const tot = R2(r.rows.reduce((s, x) => s + x.amount, 0));
    (eq(tot, 100) && eq(r.rows[0].amount, 100) && r.rows[1] === undefined)
      ? ok('CAP 20% of 1200 capped at 100 (ordered accumulation: first line takes cap)') : bad('CAP', JSON.stringify(r.rows));

    // ================= FIXED AMOUNT =================
    const fix50 = { ...pct20, id: 't4', type: 'FIXED_AMOUNT', discount_percent: null, discount_amount: '50.00' };
    L = [await mkLine(c330, 2)]; // gross 30 -> capped 30
    r = evaluate(L, [fix50], now);
    (eq(r.rows[0].amount, 30)) ? ok('FIXED 50 on 30-line capped at 30 (no negative)') : bad('FIXED cap', JSON.stringify(r.rows));
    L = [await mkLine(c1L, 10)]; // 300 -> 50
    r = evaluate(L, [fix50], now);
    (eq(r.rows[0].amount, 50)) ? ok('FIXED 50 on 300-line = 50') : bad('FIXED', JSON.stringify(r.rows));

    // ================= FIXED PRICE =================
    const fp12 = { ...pct20, id: 't5', type: 'FIXED_PRICE', discount_percent: null, fixed_price: '12.00' };
    L = [await mkLine(c330, 2)]; // (15-12)*2 = 6
    r = evaluate(L, [fp12], now);
    (eq(r.rows[0].amount, 6)) ? ok('FIXED_PRICE 12 vs base 15 ×2 = 6') : bad('FIXED_PRICE', JSON.stringify(r.rows));
    const fpEq = { ...fp12, id: 't6', fixed_price: '15.00' };
    L = [await mkLine(c330, 2)];
    r = evaluate(L, [fpEq], now);
    (r.rows.length === 0) ? ok('FIXED_PRICE == base skipped (no benefit)') : bad('FIXED_PRICE eq', JSON.stringify(r.rows));
    const fpHi = { ...fp12, id: 't7', fixed_price: '18.00' };
    L = [await mkLine(c330, 2)];
    r = evaluate(L, [fpHi], now);
    (r.rows.length === 0) ? ok('FIXED_PRICE > base skipped (never uplift)') : bad('FIXED_PRICE hi', JSON.stringify(r.rows));
    const fpKg = { ...pct20, id: 't8', type: 'FIXED_PRICE', discount_percent: null, fixed_price: '300.00', targets: [{ tt: 'VARIANT', tid: ROMI_V }] };
    L = [await mkLine(cRom, 0.5)]; // (320-300)*0.5 = 10
    r = evaluate(L, [fpKg], now);
    (eq(r.rows[0].amount, 10)) ? ok('FIXED_PRICE weighted per-KG (320-300)×0.5=10') : bad('FIXED_PRICE kg', JSON.stringify(r.rows));

    // ================= BXGY =================
    const bxg21 = { id: 'b1', type: 'BUY_X_GET_Y', scope: 'LINE', status: 'ACTIVE', start_at: null, end_at: null, priority: 20, is_stackable: false, created_at: new Date(0).toISOString(), buy_quantity: '2.000', get_quantity: '1.000', discount_percent: '100.00', targets: [{ tt: 'PRODUCT', tid: PROD_PEPSI }] };
    L = [await mkLine(c330, 3)]; // 45 gross; sets=1 free 1 → 15
    r = evaluate(L, [bxg21], now);
    (r.rows.length === 1 && eq(r.rows[0].amount, 15) && eq(r.rows[0].freeQty, 1)) ? ok('BXGY 2+1 same-variant free 15.00') : bad('BXGY 2+1', JSON.stringify(r.rows));
    const bxg350 = { ...bxg21, id: 'b2', buy_quantity: '3.000', discount_percent: '50.00' };
    L = [await mkLine(c330, 4)]; // sets=1 free 1 @50% → 7.5
    r = evaluate(L, [bxg350], now);
    (eq(r.rows[0].amount, 7.5)) ? ok('BXGY 3+1@50% = 7.50') : bad('BXGY 3+1@50', JSON.stringify(r.rows));
    L = [await mkLine(c330, 2)];
    r = evaluate(L, [bxg350], now);
    (r.rows.length === 0) ? ok('BXGY partial (2 < buy 3) earns nothing') : bad('BXGY partial', JSON.stringify(r.rows));
    L = [await mkLine(c330, 7)]; // floor(7/2)=3 → free 3 → 45
    r = evaluate(L, [bxg21], now);
    (eq(r.rows[0].amount, 45) && eq(r.rows[0].freeQty, 3)) ? ok('BXGY floor multiples 7→free 3 = 45') : bad('BXGY floor', JSON.stringify(r.rows));
    const bxgW = { ...bxg21, id: 'b3', buy_quantity: '0.500', get_quantity: '0.100', targets: [{ tt: 'VARIANT', tid: ROMI_V }] };
    L = [await mkLine(cRom, 1.2)]; // floor(1.2/0.5)=2 → free 0.2 ×320 = 64
    r = evaluate(L, [bxgW], now);
    (eq(r.rows[0].amount, 64) && eq(r.rows[0].freeQty, 0.2)) ? ok('BXGY weighted 1.2KG→free 0.2 = 64.00') : bad('BXGY weighted', JSON.stringify(r.rows));
    L = [await mkLine(cRom, 0.4)]; // below buy qty
    r = evaluate(L, [bxgW], now);
    (r.rows.length === 0) ? ok('BXGY weighted partial earns nothing') : bad('BXGY w partial', JSON.stringify(r.rows));

    // ================= STACKING / PRIORITY / SPECIFICITY =================
    const A20ns = { ...pct20, id: 'sA', priority: 10, is_stackable: false };
    const B5s = { ...pct20, id: 'sB', discount_percent: '5.00', priority: 1, is_stackable: true };
    L = [await mkLine(c330, 1)]; // 15: A first (pri10) → 3.00; B blocked (A non-stack)
    r = evaluate(L, [A20ns, B5s], now);
    (r.rows.length === 1 && eq(r.rows[0].amount, 3) && eq(L[0].net, 12)) ? ok('STACK non-stackable exclusive (3.00 only)') : bad('STACK excl', JSON.stringify([r.rows, L[0].net]));
    const A20s = { ...A20ns, id: 'sA2', is_stackable: true };
    L = [await mkLine(c330, 2)]; // 30 → 24 → 22.80 : 6 + 1.20 sequential
    r = evaluate(L, [A20s, B5s], now);
    const st = R2(r.rows.reduce((s, x) => s + x.amount, 0));
    (r.rows.length === 2 && eq(st, 7.2) && eq(L[0].net, 22.8)) ? ok('STACK sequential 30→24→22.80 (not 30−25%)') : bad('STACK seq', JSON.stringify([r.rows, L[0].net]));
    const lo5 = { ...B5s, id: 'sC', priority: 50 };
    L = [await mkLine(c330, 1)];
    r = evaluate(L, [A20ns, lo5], now); // both non-stack: pri50 wins
    (r.rows.length === 1 && eq(r.rows[0].amount, 0.75)) ? ok('PRIORITY higher wins (5% @pri50 beats 20% @pri10)') : bad('PRIORITY', JSON.stringify(r.rows));
    const seedP = await loadPromos(['01800000-0000-7000-8000-000000000601', '01800000-0000-7000-8000-000000000612']);
    L = [await mkLine(c330, 1)]; // P12 variant30 pri10 vs P1 brand20 pri10 → variant first, non-stack → only P12
    r = evaluate(L, seedP, now);
    (r.rows.length === 1 && eq(r.rows[0].amount, 4.5) && r.rows[0].promo.id.endsWith('612'))
      ? ok('SPECIFICITY variant30 beats brand20 at equal priority (4.50)') : bad('SPECIFICITY', JSON.stringify(r.rows.map(x => [x.promo.id.slice(-3), x.amount])));

    // ================= CHECKOUT + COUPON + ORDER INTEGRATION =================
    const mkCust2 = async (phone) => (await q(`INSERT INTO customers (id, first_name, phone) VALUES ($1,'T',$2) RETURNING id`, [uid(), phone])).rows[0].id;
    const mkAddr2 = async (c) => (await q(`INSERT INTO customer_addresses (id, customer_id, city, phone) VALUES ($1,$2,'Cairo','201000000001') RETURNING id`, [uid(), c])).rows[0].id;
    const ono = async () => 'HM-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String((await q(`SELECT nextval('order_number_seq') n`)).rows[0].n).padStart(6, '0');
    const vinfo = async (vid) => (await q(`SELECT v.name vn, v.price::text pr, v.size_unit su, p.name pn, p.product_type pt,
      p.sale_step_grams ss, b.name bn, p.id::text pid, p.brand_id::text bid, p.category_id::text cid
      FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN brands b ON b.id=p.brand_id WHERE v.id=$1`, [vid])).rows[0];
    const codeOf = async (vid) => (await q(`SELECT code, type FROM product_codes WHERE product_variant_id=$1 AND is_primary`, [vid])).rows[0];

    async function checkoutPromo({ custId, addrId, items, couponRaw, fee = 20, keySeed = 'p4', promoIds = null }) {
      // items: [{variant, qty}] ; returns {ok, orderId, ...} — frozen §29 + promo steps
      const all = await loadPromos(promoIds);
      await q('BEGIN');
      try {
        const cart = (await q(`INSERT INTO carts (id, customer_id) VALUES ($1,$2) RETURNING id`, [uid(), custId])).rows[0].id;
        const lines = [];
        for (const it of items) {
          const vi = await vinfo(it.variant);
          const unit = vi.pt === 'WEIGHT' ? vi.su : 'PIECE';
          await q(`INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_snapshot, unit_price_snapshot, price_checked_at)
            VALUES ($1,$2,$3,$4,$5, now())`, [cart, it.variant, it.qty, unit, vi.pr]);
          lines.push({ key: uid(), variant: it.variant, qty: String(it.qty), gross: R2(Number(it.qty) * Number(vi.pr)),
            net: R2(Number(it.qty) * Number(vi.pr)), unitPrice: Number(vi.pr), vi });
        }
        // attach frozen matching ctx; line layer mutates running nets in place
        for (const l of lines) l.ctx = { vid: l.variant, pid: l.vi.pid, bid: l.vi.bid, cid: l.vi.cid,
          pt: l.vi.pt, pu: l.vi.pt === 'WEIGHT' ? l.vi.su : 'PIECE', su: l.vi.su, price: l.vi.pr };
        const ev = evaluate(lines, all, now);
        const ord = evaluateOrder(lines, all, now); // pure; bases read current nets
        for (const r2 of ord.rows) { // sequential layering: reduce running nets, keep shares for row-writing
          const shares = allocate(r2.amount, r2.elig.map(i => ({ id: i, net: lines[i].net })));
          r2.shares = shares;
          for (const s of shares) lines[s.id].net = R2(lines[s.id].net - s.amount);
        }
        for (const r2 of ord.rows) { // apply order-auto shares sequentially, remember for row-writing
          const shares = allocate(r2.amount, r2.elig.map(i => ({ id: i, net: lines[i].net })));
          r2.shares = shares;
          for (const s of shares) lines[s.id].net = R2(lines[s.id].net - s.amount);
        }
        // coupon validate (side-effect-free) then in-tx apply
        let coupon = null, couponAmt = 0, couponBase = 0, couponShares = [], couponElig = [];
        if (couponRaw) {
          const code = normCode(couponRaw);
          if (process.env.P4DEBUG) console.log('PRE-READ ' + code + ' ' + JSON.stringify((await q(`SELECT end_at::text e, start_at::text s FROM coupons WHERE code=$1`, [code])).rows[0]));
          const cp = (await q(`SELECT c.*, c.start_at cstart, c.end_at cend, p.status pstatus, p.start_at pstart, p.end_at pend, p.type ptype, p.scope pscope,
            p.discount_percent pdp, p.discount_amount pda, pr.maximum_discount pmd
            FROM coupons c JOIN promotions p ON p.id=c.promotion_id
            LEFT JOIN promotion_rules pr ON pr.promotion_id=p.id WHERE c.code=$1`, [code])).rows[0];
          if (!cp) throw new Error('COUPON_UNKNOWN');
          const grossAll = R2(lines.reduce((s, l) => s + l.gross, 0));
          const parentEff = cp.pstatus === 'ACTIVE' && (!cp.pstart || new Date(cp.pstart) <= now) && (!cp.pend || new Date(cp.pend) > now);
          const ownWindow = (!cp.cstart || new Date(cp.cstart) <= now) && (!cp.cend || new Date(cp.cend) > now);
          if (!cp.is_active || !ownWindow || !parentEff) throw new Error('COUPON_INACTIVE');
          if (cp.minimum_order_amount != null && grossAll < Number(cp.minimum_order_amount) - 1e-9) throw new Error('COUPON_MINIMUM');
          cp.targets = (await q(`SELECT target_type tt, target_id::text tid FROM promotion_targets WHERE promotion_id=$1`, [cp.promotion_id])).rows;
          coupon = cp;
          // lock + conditional bump + per-customer count (same tx)
          await q(`SELECT * FROM coupons WHERE id=$1 FOR UPDATE`, [cp.id]);
          const bump = await q(`UPDATE coupons SET used_count = used_count + 1 WHERE id=$1
            AND (usage_limit IS NULL OR used_count < usage_limit)`, [cp.id]);
          if (!bump.rowCount) throw new Error('COUPON_EXHAUSTED');
          const cnt = await q(`SELECT COUNT(*) c FROM coupon_usages u JOIN orders o ON o.id=u.order_id
            WHERE u.coupon_id=$1 AND u.customer_id=$2 AND o.status <> 'CANCELLED'`, [cp.id, custId]);
          if (cp.per_customer_limit != null && Number(cnt.rows[0].c) >= cp.per_customer_limit) throw new Error('COUPON_PER_CUSTOMER');
          await q(`SELECT * FROM promotions WHERE id=$1 FOR UPDATE`, [cp.promotion_id]);
          const pbump = await q(`UPDATE promotions SET used_count = used_count + 1 WHERE id=$1
            AND (usage_limit IS NULL OR used_count < usage_limit)`, [cp.promotion_id]);
          if (!pbump.rowCount) throw new Error('COUPON_PROMO_EXHAUSTED');
          couponElig = lines.map((l, i) => i).filter(i => cp.targets.length === 0 || matchLine(lines[i].ctx, cp) > 0);
          couponBase = R2(couponElig.reduce((s, i) => s + lines[i].net, 0));
          couponAmt = cp.ptype === 'PERCENTAGE' ? R2(couponBase * Number(cp.pdp) / 100) : Math.min(Number(cp.pda), couponBase);
          if (cp.pmd != null) couponAmt = Math.min(couponAmt, Number(cp.pmd));
          couponShares = allocate(couponAmt, couponElig.map(i => ({ id: i, net: lines[i].net })));
          for (const s of couponShares) lines[s.id].net = R2(lines[s.id].net - s.amount);
        }
        // inventory locks ASC + reserve taken qty
        const vids = [...new Set(lines.map(l => l.variant))].sort();
        for (const v of vids) await q('SELECT * FROM inventory WHERE product_variant_id=$1 FOR UPDATE', [v]);
        for (const l of lines) {
          const rr = await q(`UPDATE inventory SET reserved_quantity = reserved_quantity + $2
            WHERE product_variant_id=$1 AND (quantity - reserved_quantity) >= $2`, [l.variant, l.qty]);
          if (!rr.rowCount) throw new Error('INSUFFICIENT:' + l.variant);
        }
        // assemble order
        const lineDisc = {};
        for (const r2 of ev.rows) lineDisc[r2.itemIdx] = R2((lineDisc[r2.itemIdx] || 0) + r2.amount);
        const sub = R2(lines.reduce((s, l) => s + l.gross, 0));
        const discTot = R2(Object.values(lineDisc).reduce((s, x) => s + x, 0) + ord.rows.reduce((s, x) => s + x.amount, 0) + couponAmt);
        const oid = uid(), on = await ono(), key = 'p4-' + keySeed + '-' + oid.slice(-6);
        await q(`INSERT INTO orders (id, order_number, customer_id, cart_id, idempotency_key, status,
          subtotal_estimated, discount_total, delivery_fee, total_estimated,
          customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_phone)
          VALUES ($1,$2,$3,$4,$5,'NEW',$6,$7,$8,$9,'T','201000000001','Cairo','201000000001')`,
          [oid, on, custId, cart, key, sub.toFixed(2), discTot.toFixed(2), fee.toFixed(2),
            R2(sub - discTot + fee).toFixed(2)]);
        const itemIds = [];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i], cd = await vinfo(l.variant), code = await codeOf(l.variant);
          const est = l.gross.toFixed(2), ld = R2(lineDisc[i] || 0);
          const ii = (await q(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot,
            variant_name_snapshot, brand_name_snapshot, product_code_snapshot, code_type_snapshot, unit_snapshot,
            product_type_snapshot, sale_step_snapshot, unit_price, requested_quantity, estimated_total, discount_amount)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [oid, l.variant, cd.pn, cd.vn, cd.bn, code ? code.code : null, code ? code.type : null,
              l.vi.pt === 'WEIGHT' ? l.vi.su : 'PIECE', cd.pt, cd.ss, Number(l.unitPrice).toFixed(2), l.qty, est, ld.toFixed(2)])).rows[0].id;
          itemIds.push(ii);
          l._itemId = ii; l._lineDisc = ld;
        }
        // order_discounts rows: line applications (zero-amount rows never stored;
        // cross-variant free specs are materialized by the caller, not stored here)
        for (const r2 of ev.rows) {
          if (r2.amount <= 0) continue;
          const l = lines[r2.itemIdx], p = r2.promo;
          await q(`INSERT INTO order_discounts (order_id, order_item_id, promotion_id, kind,
            promotion_name_snapshot, type_snapshot, scope_snapshot, applied_percent, applied_amount,
            applied_fixed_price, cap_amount, base_estimated, discount_estimated)
            VALUES ($1,$2,$3,'PROMOTION_LINE',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [oid, l._itemId, p.id, p.name, p.type, p.scope,
              p.type === 'PERCENTAGE' || p.type === 'BUY_X_GET_Y' ? (p.type === 'BUY_X_GET_Y' ? p.buy_pct : p.discount_percent) : null,
              p.type === 'FIXED_AMOUNT' ? p.discount_amount : null,
              p.type === 'FIXED_PRICE' ? p.fixed_price : null,
              p.maximum_discount, r2.base.toFixed(2), r2.amount.toFixed(2)]);
        }
        // order-level auto applications + allocations
        for (const r2 of ord.rows) {
          const p = r2.promo;
          const app = (await q(`INSERT INTO order_discounts (order_id, promotion_id, kind,
            promotion_name_snapshot, type_snapshot, scope_snapshot, applied_percent, applied_amount,
            applied_fixed_price, cap_amount, base_estimated, discount_estimated)
            VALUES ($1,$2,'PROMOTION_ORDER',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [oid, p.id, p.name, p.type, p.scope,
              p.type === 'PERCENTAGE' ? p.discount_percent : null,
              p.type === 'FIXED_AMOUNT' ? p.discount_amount : null, null,
              p.maximum_discount, r2.base.toFixed(2), r2.amount.toFixed(2)])).rows[0].id;
          const elig = r2.shares.map(s => ({ id: lines[s.id]._itemId, amount: s.amount }));
          for (const a of elig) {
            if (a.amount <= 0) continue;
            await q(`INSERT INTO order_discounts (order_id, order_item_id, promotion_id, kind,
              promotion_name_snapshot, type_snapshot, scope_snapshot, base_estimated, discount_estimated, parent_discount_id)
              VALUES ($1,$2,$3,'ALLOCATION',$4,$5,$6,$7,$8,$9)`,
              [oid, a.id, p.id, p.name, p.type, p.scope, a.amount.toFixed(2), a.amount.toFixed(2), app]);
            const cur = await q(`SELECT discount_amount::text d FROM order_items WHERE id=$1`, [a.id]);
            await q(`UPDATE order_items SET discount_amount=$2 WHERE id=$1`, [a.id, R2(Number(cur.rows[0].d) + a.amount).toFixed(2)]);
          }
        }
        // coupon application + usages + allocation over nets
        if (coupon) {
          const app = (await q(`INSERT INTO order_discounts (order_id, promotion_id, coupon_id, kind,
            promotion_name_snapshot, type_snapshot, scope_snapshot, applied_percent, applied_amount,
            applied_fixed_price, cap_amount, base_estimated, discount_estimated)
            VALUES ($1,$2,$3,'COUPON',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [oid, coupon.promotion_id, coupon.id, coupon.name || 'coupon', coupon.ptype, coupon.pscope,
              coupon.ptype === 'PERCENTAGE' ? coupon.pdp : null,
              coupon.ptype === 'FIXED_AMOUNT' ? coupon.pda : null, null,
              coupon.pmd, couponBase.toFixed(2), couponAmt.toFixed(2)])).rows[0].id;
          await q(`INSERT INTO coupon_usages (coupon_id, customer_id, order_id, estimated_discount_amount)
            VALUES ($1,$2,$3,$4)`, [coupon.id, custId, oid, couponAmt.toFixed(2)]);
          const elig = couponShares.map(s => ({ id: lines[s.id]._itemId, amount: s.amount }));
          for (const a of elig) {
            if (a.amount <= 0) continue;
            await q(`INSERT INTO order_discounts (order_id, order_item_id, promotion_id, coupon_id, kind,
              promotion_name_snapshot, type_snapshot, scope_snapshot, base_estimated, discount_estimated, parent_discount_id)
              VALUES ($1,$2,$3,$4,'ALLOCATION',$5,$6,$7,$8,$9,$10)`,
              [oid, a.id, coupon.promotion_id, coupon.id, coupon.name || 'coupon', coupon.ptype, coupon.pscope,
                a.amount.toFixed(2), a.amount.toFixed(2), app]);
            const cur = await q(`SELECT discount_amount::text d FROM order_items WHERE id=$1`, [a.id]);
            await q(`UPDATE order_items SET discount_amount=$2 WHERE id=$1`, [a.id, R2(Number(cur.rows[0].d) + a.amount).toFixed(2)]);
          }
        }
        await q(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id) VALUES ($1,NULL,'NEW','CUSTOMER',$2)`, [oid, custId]);
        await q(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id) VALUES ($1,'NEW','CONFIRMED','CUSTOMER',$2)`, [oid, custId]);
        await q(`UPDATE orders SET status='CONFIRMED' WHERE id=$1`, [oid]);
        await q(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [cart]);
        await q('COMMIT');
        return { ok: true, orderId: oid, key };
      } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
    }

    async function finalizePromo(orderId, actuals) {
      // actuals: {itemId: qty} — recompute finals from ROW snapshots only
      await q('BEGIN');
      try {
        // caller advances order to PREPARING (frozen lifecycle); finalize only completes money
        for (const [itemId, act] of Object.entries(actuals)) {
          const it = (await q(`SELECT * FROM order_items WHERE id=$1`, [itemId])).rows[0];
          const fin = R2(Number(act) * Number(it.unit_price)).toFixed(2);
          const st = Number(act) < Number(it.requested_quantity) - 1e-9 ? 'PARTIALLY_FULFILLED' : 'FULFILLED';
          await q(`UPDATE order_items SET actual_quantity=$2, final_total=$3, item_status=$4 WHERE id=$1`, [itemId, act, fin, st]);
          // PROMOTION_LINE rows only (ALLOCATION children recomputed via parents below).
          // Cap accumulates per promo across its lines in item-id order (mirrors estimate layering).
          const rows = (await q(`SELECT * FROM order_discounts WHERE order_item_id=$1 AND kind='PROMOTION_LINE' ORDER BY promotion_id, id`, [itemId])).rows;
          let mirror = 0;
          const capLeft = {};
          for (const r2 of rows) {
            let f = 0;
            const b = R2(Number(act) * Number(it.unit_price));
            if (r2.type_snapshot === 'PERCENTAGE' || r2.type_snapshot === 'BUY_X_GET_Y')
              f = R2(b * Number(r2.applied_percent) / 100);
            else if (r2.type_snapshot === 'FIXED_AMOUNT') f = Math.min(Number(r2.applied_amount), b);
            else if (r2.type_snapshot === 'FIXED_PRICE')
              f = R2(Math.max(0, Number(it.unit_price) - Number(r2.applied_fixed_price)) * Number(act));
            f = Math.min(f, b);
            if (r2.cap_amount != null) {
              const key = r2.promotion_id;
              if (!(key in capLeft)) {
                const spent = await q(`SELECT COALESCE(SUM(discount_final),0)::text t FROM order_discounts
                  WHERE order_id=$1 AND promotion_id=$2 AND kind='PROMOTION_LINE' AND discount_final IS NOT NULL`, [orderId, key]);
                capLeft[key] = Number(r2.cap_amount) - Number(spent.rows[0].t);
              }
              f = Math.min(f, Math.max(0, capLeft[key]));
              capLeft[key] = R2(capLeft[key] - f);
            }
            await q(`UPDATE order_discounts SET base_final=$2, discount_final=$3 WHERE id=$1`, [r2.id, b.toFixed(2), f.toFixed(2)]);
            mirror = R2(mirror + f);
          }
          await q(`UPDATE order_items SET discount_amount=$2 WHERE id=$1`, [itemId, mirror.toFixed(2)]);
        }
        // order-level rows: recompute on actual nets (deterministic pro-rata again)
        const items = (await q(`SELECT id::text i, final_total::text f FROM order_items WHERE order_id=$1`, [orderId])).rows;
        const pend = (await q(`SELECT COUNT(*) c FROM order_items WHERE order_id=$1 AND item_status='PENDING'`, [orderId])).rows[0].c;
        const subs = items.filter(x => x.f != null).reduce((s, x) => R2(s + Number(x.f)), 0);
        for (const r2 of (await q(`SELECT * FROM order_discounts WHERE order_id=$1 AND kind IN ('PROMOTION_ORDER','COUPON')`, [orderId])).rows) {
          // eligible set = frozen evidence: items holding ALLOCATION children under this parent.
          // Fallback (no children, e.g. zero-amount edge): all finalized lines — same rule as checkout.
          const kids = (await q(`SELECT order_item_id::text i FROM order_discounts WHERE parent_discount_id=$1`, [r2.id])).rows.map(x => x.i);
          const scope = kids.length ? items.filter(x => x.f != null && kids.includes(x.i)) : items.filter(x => x.f != null);
          const eligNets = scope.map(x => ({ id: x.i, net: Number(x.f) }));
          const totElig = eligNets.reduce((s, x) => s + x.net, 0);
          let f = r2.type_snapshot === 'PERCENTAGE' ? R2(totElig * Number(r2.applied_percent) / 100)
            : Math.min(Number(r2.applied_amount), totElig);
          if (r2.cap_amount != null) f = Math.min(f, Number(r2.cap_amount));
          await q(`UPDATE order_discounts SET base_final=$2, discount_final=$3 WHERE id=$1`, [r2.id, R2(totElig).toFixed(2), f.toFixed(2)]);
          // re-allocate children deterministically
          await q(`DELETE FROM order_discounts WHERE parent_discount_id=$1`, [r2.id]);
          for (const a of allocate(f, eligNets.length ? eligNets : items.map(x => ({ id: x.i, net: 0 })))) {
            if (a.amount <= 0) continue;
            await q(`INSERT INTO order_discounts (order_id, order_item_id, promotion_id, coupon_id, kind,
              promotion_name_snapshot, type_snapshot, scope_snapshot, base_estimated, discount_estimated,
              base_final, discount_final, parent_discount_id)
              VALUES ($1,$2,$3,$4,'ALLOCATION',$5,$6,$7,$8,$8,$9,$9,$10)`,
              [orderId, a.id, r2.promotion_id, r2.coupon_id, r2.promotion_name_snapshot, r2.type_snapshot,
                r2.scope_snapshot, a.amount.toFixed(2), a.amount.toFixed(2), r2.id]);
          }
        }
        // refresh mirrors from final children
        for (const x of items) {
          const m = await q(`SELECT COALESCE(SUM(discount_final),0)::text t FROM order_discounts
            WHERE order_item_id=$1 AND kind IN ('PROMOTION_LINE','ALLOCATION')`, [x.i]);
          await q(`UPDATE order_items SET discount_amount=$2 WHERE id=$1`, [x.i, Number(m.rows[0].t).toFixed(2)]);
        }
        if (Number(pend) === 0) {
          const s2 = await q(`SELECT COALESCE(SUM(final_total),0)::text t FROM order_items
            WHERE order_id=$1 AND item_status IN ('FULFILLED','PARTIALLY_FULFILLED')`, [orderId]);
          // CONFLICT RESOLUTION (approved): orders.discount_total stays the checkout-agreed
          // ESTIMATE (frozen chk_orders_total_estimated binds it to the estimate equation).
          // total_final therefore applies the frozen estimate discount to final gross.
          // Final detailed discounts live in order_discounts/coupon_usages + item mirrors.
          await q(`UPDATE coupon_usages SET final_discount_amount=(
            SELECT COALESCE(SUM(discount_final),0) FROM order_discounts WHERE order_id=$1 AND kind='COUPON') WHERE order_id=$1`, [orderId]);
          await q(`UPDATE orders SET subtotal_final=$2,
            total_final = $2 - LEAST(discount_total, $2) + delivery_fee WHERE id=$1`,
            [orderId, s2.rows[0].t]);
        }
        await q('COMMIT');
        return { ok: true };
      } catch (e) { try { await q('ROLLBACK'); } catch (_) {} return { ok: false, reason: e.message }; }
    }

    const Tcust = async (ph) => (await q(`INSERT INTO customers (id, first_name, phone) VALUES ($1,'T',$2) RETURNING id`, [uid(), ph])).rows[0].id;
    const Taddr = async (c) => (await q(`INSERT INTO customer_addresses (id, customer_id, city, phone) VALUES ($1,$2,'Cairo','201000000001') RETURNING id`, [uid(), c])).rows[0].id;

    // ================= COUPON TESTS =================
    let tc = await Tcust('201011100001'); let ta = await Taddr(tc);
    let co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P1L, qty: 10 }], couponRaw: 'welcome50', fee: 0, keySeed: 'cp1', promoIds: [] });
    // gross 300 >= min 200 → 50 fixed
    let od = co.ok ? (await q(`SELECT kind k, discount_estimated::text a, coupon_id::text c FROM order_discounts WHERE order_id=$1 ORDER BY kind`, [co.orderId])).rows : [];
    (co.ok && od.some(r => r.k === 'COUPON' && r.a === '50.00' && r.c)) ? ok('COUPON valid WELCOME50 (case-insensitive input) = 50.00') : bad('COUPON valid', JSON.stringify({ co, od }));
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P330, qty: 1 }], couponRaw: 'WELCOME50', fee: 0, keySeed: 'cp2', promoIds: [] });
    (!co.ok && /MINIMUM/.test(co.reason)) ? ok('COUPON minimum blocks 15 < 200') : bad('COUPON minimum', JSON.stringify(co));
    await q(`UPDATE coupons SET is_active=FALSE WHERE code='WELCOME50'`);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P1L, qty: 10 }], couponRaw: 'WELCOME50', fee: 0, keySeed: 'cp3', promoIds: [] });
    (!co.ok && /INACTIVE/.test(co.reason)) ? ok('COUPON disabled rejected') : bad('COUPON disabled', JSON.stringify(co));
    await q(`UPDATE coupons SET is_active=TRUE WHERE code='WELCOME50'`);
    await q(`UPDATE coupons SET end_at = now() - INTERVAL '1 day' WHERE code='FLASH5'`);
    if (process.env.P4DEBUG) console.log('AFTER-UPDATE ' + JSON.stringify((await q(`SELECT end_at::text e FROM coupons WHERE code='FLASH5'`)).rows[0]));
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P1L, qty: 10 }], couponRaw: 'FLASH5', fee: 0, keySeed: 'cp4', promoIds: [] });
    (!co.ok && /INACTIVE/.test(co.reason)) ? ok('COUPON expired rejected') : bad('COUPON expired', JSON.stringify(co));
    await q(`UPDATE coupons SET end_at=NULL WHERE code='FLASH5'`);
    await q(`UPDATE coupons SET start_at = now() + INTERVAL '1 day' WHERE code='FLASH5'`);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P1L, qty: 10 }], couponRaw: 'FLASH5', fee: 0, keySeed: 'cp5', promoIds: [] });
    (!co.ok && /INACTIVE/.test(co.reason)) ? ok('COUPON before-start rejected') : bad('COUPON before-start', JSON.stringify(co));
    await q(`UPDATE coupons SET start_at=NULL WHERE code='FLASH5'`);
    // per-customer: WELCOME50 limit 1 — tc already used once (cp1)
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P1L, qty: 10 }], couponRaw: 'WELCOME50', fee: 0, keySeed: 'cp6', promoIds: [] });
    (!co.ok && /PER_CUSTOMER/.test(co.reason)) ? ok('COUPON per-customer limit 1 blocks 2nd use') : bad('COUPON per-customer', JSON.stringify(co));
    // LOYAL10 limit 2: two ok, third fails
    let tc2 = await Tcust('201011100002'); let ta2 = await Taddr(tc2);
    const loy = [];
    for (let k = 0; k < 3; k++) loy.push(await checkoutPromo({ custId: tc2, addrId: ta2, items: [{ variant: P1L, qty: 10 }], couponRaw: 'LOYAL10', fee: 0, keySeed: 'loy' + k, promoIds: [] }));
    (loy[0].ok && loy[1].ok && !loy[2].ok && /PER_CUSTOMER/.test(loy[2].reason)) ? ok('COUPON per-customer limit 2 (2 ok, 3rd blocked)') : bad('LOYAL10', JSON.stringify(loy.map(x => x.ok)));
    // duplicate order usage: raw second usages row same order rejected
    const usedOrder = loy[0].orderId;
    const cpId = (await q(`SELECT id::text i FROM coupons WHERE code='LOYAL10'`)).rows[0].i;
    await q(`INSERT INTO coupon_usages (coupon_id, customer_id, order_id, estimated_discount_amount) VALUES ($1,$2,$3,1)`, [cpId, tc2, usedOrder])
      .then(() => bad('COUPON dup order usage rejected', 'accepted'))
      .catch((e) => /unique|duplicate/i.test(e.message) ? ok('COUPON dup order usage rejected (UQ order_id)') : bad('COUPON dup', e));
    // promotion expired but coupon active => INVALID (disable parent promo of LOYAL10)
    await q(`UPDATE promotions SET status='DISABLED' WHERE id='01800000-0000-7000-8000-000000000609'`);
    co = await checkoutPromo({ custId: tc2, addrId: ta2, items: [{ variant: P1L, qty: 10 }], couponRaw: 'LOYAL10', fee: 0, keySeed: 'cp7', promoIds: [] });
    (!co.ok && /INACTIVE/.test(co.reason)) ? ok('COUPON parent-disabled invalidates coupon') : bad('COUPON parent', JSON.stringify(co));
    await q(`UPDATE promotions SET status='ACTIVE' WHERE id='01800000-0000-7000-8000-000000000609'`);

    // ================= WEIGHTED =================
    tc = await Tcust('201011100003'); ta = await Taddr(tc);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: ROMI_V, qty: 0.5 }], fee: 0, keySeed: 'w1', promoIds: ['01800000-0000-7000-8000-000000000605'] });
    od = co.ok ? (await q(`SELECT base_estimated::text b, discount_estimated::text d FROM order_discounts WHERE order_id=$1 AND kind='PROMOTION_LINE'`, [co.orderId])).rows[0] : null;
    (co.ok && od && od.b === '160.00' && od.d === '16.00') ? ok('WEIGHTED Romi 10%: gross 160 discount 16 net 144') : bad('WEIGHTED est', JSON.stringify({ co, od }));
    const itw = (await q(`SELECT id::text i FROM order_items WHERE order_id=$1`, [co.orderId])).rows[0].i;
    // frozen write order: history row FIRST, then status UPDATE (audit trigger)
    await q(`INSERT INTO order_status_history (order_id, old_status, new_status, actor_type, actor_id) VALUES ($1,'CONFIRMED','PREPARING','STAFF',$2)`, [co.orderId, tc]);
    await q(`UPDATE orders SET status='PREPARING' WHERE id=$1`, [co.orderId]);
    let fz = await finalizePromo(co.orderId, { [itw]: '0.475' });
    od = (await q(`SELECT base_final::text b, discount_final::text d FROM order_discounts WHERE order_id=$1 AND kind='PROMOTION_LINE'`, [co.orderId])).rows[0];
    const oi = (await q(`SELECT final_total::text f, discount_amount::text d FROM order_items WHERE id=$1`, [itw])).rows[0];
    const oh = (await q(`SELECT discount_total::text d, total_estimated::text e, subtotal_final::text s, total_final::text t FROM orders WHERE id=$1`, [co.orderId])).rows[0];
    (fz.ok && od.b === '152.00' && od.d === '15.20' && oi.f === '152.00' && oi.d === '15.20'
      && oh.d === '16.00' && oh.e === '144.00' && oh.s === '152.00' && oh.t === '136.00')
      ? ok('WEIGHTED finalize 0.475: detail 152/15.20, discount_total frozen 16.00, total_final 136.00')
      : bad('WEIGHTED final', JSON.stringify({ fz: fz.reason || 'ok', od, oi, oh }));
    // §11 reconciliation: est 16.00 vs final 15.20, diff 0.80 from qty 0.500→0.475 (not pricing error)
    {
      const est = await q(`SELECT discount_estimated::text d FROM order_discounts WHERE order_id=$1 AND kind='PROMOTION_LINE'`, [co.orderId]);
      const fin = await q(`SELECT discount_final::text d FROM order_discounts WHERE order_id=$1 AND kind='PROMOTION_LINE'`, [co.orderId]);
      const diff = R2(Number(est.rows[0].d) - Number(fin.rows[0].d));
      const qty = await q(`SELECT requested_quantity::text r, actual_quantity::text a, unit_price::text p FROM order_items WHERE id=$1`, [itw]);
      const expectDiff = R2((Number(qty.rows[0].r) - Number(qty.rows[0].a)) * Number(qty.rows[0].p)
        * Number((await q(`SELECT applied_percent::text p FROM order_discounts WHERE order_id=$1 AND kind='PROMOTION_LINE'`, [co.orderId])).rows[0].p) / 100);
      const ms = await q(`SELECT COALESCE(SUM(discount_amount),0)::text t FROM order_items WHERE order_id=$1`, [co.orderId]);
      const ds = await q(`SELECT COALESCE(SUM(discount_final),0)::text t FROM order_discounts WHERE order_id=$1 AND kind IN ('PROMOTION_LINE','ALLOCATION')`, [co.orderId]);
      (diff === 0.8 && expectDiff === 0.8 && ms.rows[0].t === ds.rows[0].t)
        ? ok('RECONCILE est 16.00 − final 15.20 = 0.80 from qty delta; Σ mirrors = Σ finals')
        : bad('RECONCILE', JSON.stringify({ diff, expectDiff, ms: ms.rows[0].t, ds: ds.rows[0].t }));
    }
    // 0.125 KG + percent with fractional cents: 33.33% of 40 = 13.33? 40*0.3333=13.332→13.33
    const pct3333 = (await q(`INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority) VALUES ($1,'t33','PERCENTAGE','LINE','ACTIVE',33.33,0) RETURNING id`, [uid()])).rows[0].id;
    await q(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ($1,'VARIANT',$2)`, [pct3333, ROMI_V]);
    tc = await Tcust('201011100004'); ta = await Taddr(tc);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: ROMI_V, qty: 0.125 }], fee: 0, keySeed: 'w2', promoIds: [pct3333] });
    od = co.ok ? (await q(`SELECT discount_estimated::text d FROM order_discounts WHERE order_id=$1`, [co.orderId])).rows[0] : null;
    (co.ok && od.d === '13.33') ? ok('WEIGHTED rounding 33.33% of 40.00 = 13.33') : bad('WEIGHTED rounding', JSON.stringify({ co, od }));

    // ================= ORDER / ALLOCATION / MIRROR =================
    tc = await Tcust('201011100005'); ta = await Taddr(tc);
    // lines 100 + 100 + 300 via custom prices? use real variants: 2×P1L(60)+... build 100/100/300:
    // 330ML×? 15s can't make 100. Use direct order assembly? Simpler: test allocation() unit + one live coupon case.
    const alc = allocate(50, [{ id: 'i1', net: 100 }, { id: 'i2', net: 100 }, { id: 'i3', net: 300 }]);
    const asum = R2(alc.reduce((s, x) => s + x.amount, 0));
    (asum === 50 && eq(alc.find(x => x.id === 'i1').amount, 10) && eq(alc.find(x => x.id === 'i3').amount, 30))
      ? ok('ALLOC 50 over 100/100/300 = 10/10/30 exact') : bad('ALLOC', JSON.stringify(alc));
    const alc2 = allocate(10, [{ id: 'i1', net: 100 }, { id: 'i2', net: 100 }, { id: 'i3', net: 100 }]);
    const asum2 = R2(alc2.reduce((s, x) => s + x.amount, 0));
    (asum2 === 10 && eq(alc2[0].amount, 3.34)) ? ok('ALLOC dust 10/3 = 3.34/3.33/3.33 (largest remainder)') : bad('ALLOC dust', JSON.stringify(alc2));
    // live coupon allocation on real checkout: LOYAL10 (10%) on 300 gross → 30, single line
    tc = await Tcust('201011100006'); ta = await Taddr(tc);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P1L, qty: 10 }], couponRaw: 'LOYAL10', fee: 0, keySeed: 'al1', promoIds: [] });
    const alrows = co.ok ? (await q(`SELECT kind k, order_item_id::text i, discount_estimated::text d, parent_discount_id::text p
      FROM order_discounts WHERE order_id=$1 ORDER BY kind`, [co.orderId])).rows : [];
    const kids = alrows.filter(r => r.k === 'ALLOCATION');
    const krow = alrows.find(r => r.k === 'COUPON');
    (co.ok && krow && krow.d === '30.00' && kids.length === 1 && kids[0].d === '30.00' && kids[0].p)
      ? ok('ALLOC live: coupon 30 → 1 child 30.00, parent linked') : bad('ALLOC live', JSON.stringify({ co: co.ok, alrows }));
    const mir = co.ok ? (await q(`SELECT discount_amount::text d FROM order_items WHERE order_id=$1`, [co.orderId])).rows[0].d : null;
    (mir === '30.00') ? ok('MIRROR items.discount_amount = 30.00') : bad('MIRROR', mir);
    const dt = co.ok ? (await q(`SELECT discount_total::text d, total_estimated::text t FROM orders WHERE id=$1`, [co.orderId])).rows[0] : null;
    (dt && dt.d === '30.00' && dt.t === '270.00') ? ok('TOTALS discount_total=30 total=270 (CHECK-balanced)') : bad('TOTALS', JSON.stringify(dt));

    // ================= INVENTORY BXGY =================
    tc = await Tcust('201011100007'); ta = await Taddr(tc);
    await q(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id=$1`, [P330]);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P330, qty: 3 }], fee: 0, keySeed: 'bx1',
      promoIds: ['01800000-0000-7000-8000-000000000603'] });
    const inv330 = co.ok ? (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id=$1`, [P330])).rows[0].r : null;
    (co.ok && inv330 === '3.000') ? ok('BXGY reserves TAKEN qty 3 (incl. free unit)') : bad('BXGY reserve', JSON.stringify({ co, inv330 }));
    // cross-variant free: buy 2×330 + free 1×1L line (dedicated priced line + 100% discount row)
    await q(`UPDATE inventory SET quantity=100.000, reserved_quantity=0 WHERE product_variant_id IN ($1,$2)`, [P330, P1L]);
    const bxgX = (await q(`INSERT INTO promotions (id, name, type, scope, status, priority) VALUES ($1,'t-bxgx','BUY_X_GET_Y','LINE','ACTIVE',0) RETURNING id`, [uid()])).rows[0].id;
    await q(`INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES ($1,'PRODUCT',$2)`, [bxgX, PROD_PEPSI]);
    await q(`INSERT INTO promotion_buy_get_rules (promotion_id, buy_quantity, get_quantity, discount_percent, free_variant_id)
      VALUES ($1,2,1,100,$2)`, [bxgX, P1L]);
    tc = await Tcust('201011100008'); ta = await Taddr(tc);
    co = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P330, qty: 2 }], fee: 0, keySeed: 'bx2', promoIds: [bxgX] });
    // harness adds the free line explicitly (engine output wiring): reserve + priced line + full discount row
    let freeOk = false, freeErr = null;
    if (co.ok) {
      await q('BEGIN');
      try {
        const rr = await q(`UPDATE inventory SET reserved_quantity = reserved_quantity + 1 WHERE product_variant_id=$1
          AND (quantity - reserved_quantity) >= 1 RETURNING 1`, [P1L]);
        if (!rr.rowCount) throw new Error('FREE_SHORT');
        const fl = (await q(`INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot,
          variant_name_snapshot, unit_snapshot, product_type_snapshot, unit_price, requested_quantity,
          estimated_total, discount_amount) VALUES ($1,$2,'Pepsi','1 L','PIECE','PIECE',30.00,'1.000',30.00,30.00) RETURNING id`, [co.orderId, P1L])).rows[0].id;
        await q(`INSERT INTO order_discounts (order_id, order_item_id, promotion_id, kind,
          promotion_name_snapshot, type_snapshot, scope_snapshot, applied_percent,
          base_estimated, discount_estimated) VALUES ($1,$2,$3,'PROMOTION_LINE','t-bxgx','BUY_X_GET_Y','LINE',100,$4,$4)`, [co.orderId, fl, bxgX, '30.00']);
        // discount_total absorbs the free-line application (same tx — mirrors backend wiring).
        // NOTE: RHS sees OLD row values, so the +30 is spelled out in the total equation.
        await q(`UPDATE orders SET discount_total = discount_total + 30.00,
          total_estimated = subtotal_estimated - (discount_total + 30.00) + delivery_fee WHERE id=$1`, [co.orderId]);
        await q('COMMIT'); freeOk = true;
      } catch (e) { try { await q('ROLLBACK'); } catch (_) {} freeOk = false; freeErr = e.message.split('\n')[0]; }
    }
    const inv1L = (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id=$1`, [P1L])).rows[0].r;
    (freeOk && inv1L === '1.000') ? ok('BXGY cross-variant: free 1L line priced 30 + 100% discount, reserved 1.0') : bad('BXGY cross', JSON.stringify({ co: co.reason || 'ok', freeOk, freeErr }));

    // ================= IDEMPOTENCY =================
    // checkoutPromo owns cart creation (one ACTIVE per customer enforced); the raw
    // re-insert below reuses the CHECKED_OUT cart of the created order.
    tc = await Tcust('201011100009'); ta = await Taddr(tc);
    // same logical checkout twice with same key: emulate via checkoutPromo currency — count orders/usages/discounts
    const kSame = 'idem-p4-001';
    const rA1 = await checkoutPromo({ custId: tc, addrId: ta, items: [{ variant: P330, qty: 1 }], fee: 0, keySeed: 'sameA', promoIds: [] });
    if (!rA1.ok) { bad('IDEM setup checkout', rA1.reason); }
    else {
    const cart1 = (await q(`SELECT cart_id::text c FROM orders WHERE id=$1`, [rA1.orderId])).rows[0].c;
    // force same idempotency key on retry: raw re-insert must die on UNIQUE
    await q(`INSERT INTO orders (customer_id, cart_id, idempotency_key, order_number, subtotal_estimated, total_estimated,
      customer_name_snapshot, customer_phone_snapshot, delivery_city, delivery_phone)
      VALUES ($1,$2,$3,'HM-20260916-888888',15,15,'T','201000000001','Cairo','201000000001')`, [tc, cart1, (await q(`SELECT idempotency_key FROM orders WHERE id=$1`, [rA1.orderId])).rows[0].idempotency_key])
      .then(() => bad('IDEM dup key rejected', 'accepted'))
      .catch((e) => /unique|duplicate/i.test(e.message) ? ok('IDEM dup key rejected (UNIQUE)') : bad('IDEM dup', e));
    }
    void kSame;

    // ================= INVARIANT BATTERY =================
    await q(`SELECT COUNT(*) c FROM inventory WHERE NOT (quantity = available_quantity + reserved_quantity)
      OR quantity < 0 OR reserved_quantity < 0 OR available_quantity < 0`).then(r =>
      (r.rows[0].c == 0 ? ok('V-INV identity + non-negative all rows') : bad('V-INV', r.rows[0].c)));
    await q(`SELECT COUNT(*) c FROM order_discounts WHERE discount_estimated < 0 OR discount_estimated > base_estimated
      OR (discount_final IS NOT NULL AND (discount_final < 0 OR base_final IS NULL OR discount_final > base_final))`).then(r =>
      (r.rows[0].c == 0 ? ok('V-DISC 0 ≤ discount ≤ base') : bad('V-DISC', r.rows[0].c)));
    await q(`SELECT COUNT(*) c FROM coupons WHERE usage_limit IS NOT NULL AND used_count > usage_limit`).then(r =>
      (r.rows[0].c == 0 ? ok('V-COUPON used ≤ limit') : bad('V-COUPON', r.rows[0].c)));
    await q(`SELECT COUNT(*) c FROM promotions WHERE usage_limit IS NOT NULL AND used_count > usage_limit`).then(r =>
      (r.rows[0].c == 0 ? ok('V-PROMO used ≤ limit') : bad('V-PROMO', r.rows[0].c)));
    await q(`SELECT o.id FROM orders o WHERE o.discount_total <> COALESCE(
      (SELECT SUM(discount_estimated) FROM order_discounts WHERE order_id=o.id
       AND kind IN ('PROMOTION_LINE','PROMOTION_ORDER','COUPON')),0)`).then(r =>
      (r.rows.length === 0 ? ok('V-TOT discount_total = Σ application rows') : bad('V-TOT', JSON.stringify(r.rows.map(x => x.id)))));
    await q(`SELECT oi.id FROM order_items oi WHERE oi.discount_amount <> COALESCE(
      (SELECT SUM(COALESCE(discount_final, discount_estimated)) FROM order_discounts WHERE order_item_id=oi.id
       AND kind IN ('PROMOTION_LINE','ALLOCATION')),0)`).then(r =>
      (r.rows.length === 0 ? ok('V-MIR mirror = Σ line-attributed rows (final when set, else estimate)') : bad('V-MIR', JSON.stringify(r.rows.map(x => x.id)))));
    const seedPrices = await q(`SELECT price::text p FROM product_variants WHERE id IN ($1,$2) ORDER BY id`, [ROMI_V, P330]);
    // NOTE: seed prices may have been touched by earlier phase-2 suites in other DBs; here PGlite is fresh:
    // ROMI 320, P330 15 expected (nothing in THIS suite mutates base prices)
    (seedPrices.rows[0].p === '320.00' && seedPrices.rows[1].p === '15.00')
      ? ok('V-BASE base prices untouched (320 / 15)') : bad('V-BASE', JSON.stringify(seedPrices.rows));

    console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) { console.log('HARNESS ERROR: ' + e.message); process.exitCode = 1; }
})();

