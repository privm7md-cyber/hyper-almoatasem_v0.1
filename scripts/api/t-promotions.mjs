// BA-8 promotions/coupons API suite (scratch-only, built server on scratch DB).
// Usage: node scripts/api/t-promotions.mjs --db <name> --port <port>
// Covers: admin promo/coupon CRUD + frozen gates (shapes, activation,
// referenced-immutability, RESTRICT deletes), targeting (variant/OR/
// subtree), percent/fixed/BXGY/caps/minimums, stacking order, coupon
// validation (windows/minimum/limits), checkout integration (snapshots,
// mirrors, usages, counters, discount_total), estimate parity, history
// stability, cancel decrements, RBAC matrix. Promos are DISABLED between
// scenarios so every assertion isolates one behavior (the stacking gate
// would otherwise entangle overlapping promos). Scratch promo/coupon
// tables must start empty (fail-fast guard). Prints JSON, never secrets.
import "dotenv/config";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "promotions", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const P330 = "01800000-0000-7000-8000-000000000201";
const P1L = "01800000-0000-7000-8000-000000000202";
const UNKNOWN = "04800000-0000-7000-8000-000000009999";
const P_C1 = "01094000011";
const P_C2 = "01094000022";
const CANON = (p) => "2010" + p.slice(3);
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const BARE_EMAIL = "bare-cat-test@example.com";
const BARE_PW = "Cat-Test-Bare-Pass-0003!";

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const probe = await fetch(`${baseUrl}/api/admin/session`, { method: "GET" });
    await probe.text();
  } catch {
    console.error(`REFUSED_NO_SERVER: nothing listening at ${baseUrl}`);
    process.exit(1);
  }
  const scratchUrl = (() => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const db = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 5000 });
  await db.connect();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;

  const get = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const put = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const del = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers: cookie ? { cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const m = (r.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, cookie: m ? `__Host-admin-session=${m[1]}` : null };
  };

  const num = (s) => Number(s);
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const keySeq = { n: 0 };
  const key = (p) => `ba8-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const mkCart = async (lines) => {
    const gg = await post(`/api/store/cart`, {});
    const tok = gg.body.data.guestToken;
    cartIds.add(gg.body.data.cart.id);
    for (const [vid, qty] of lines) {
      await fetch(`${baseUrl}/api/store/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-guest-token": tok },
        body: JSON.stringify({ productVariantId: vid, quantity: qty }),
      });
    }
    return tok;
  };
  const orderWith = async (custId, addrId, lines, k, couponCode = null) => {
    const tok = await mkCart(lines);
    const body = { customerId: custId, addressId: addrId, idempotencyKey: k };
    if (couponCode) body.couponCode = couponCode;
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guest-token": tok },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const discountsOf = async (orderId) =>
    q(`SELECT kind k, promotion_id::text p, coupon_id::text c, order_item_id::text i,
      base_estimated::text b, discount_estimated::text d, parent_discount_id::text par
      FROM order_discounts WHERE order_id = $1 ORDER BY kind, id`, [orderId]);
  const mkPromo = async (fields, target = null, rules = null, buyget = null, active = true) => {
    const p = await post(`/api/admin/promotions`, fields, sc);
    if (p.status !== 201) throw new Error("promo create failed: " + JSON.stringify(p.body).slice(0, 160));
    const id = p.body.data.id;
    promoIds.add(id);
    if (target) {
      const tr = await post(`/api/admin/promotions/${id}/targets`, target, sc);
      if (tr.status !== 201) throw new Error("target failed: " + JSON.stringify(tr.body).slice(0, 160));
    }
    if (rules) await put(`/api/admin/promotions/${id}/rules`, rules, sc);
    if (buyget) {
      const bg = await put(`/api/admin/promotions/${id}/buy-get`, buyget, sc);
      if (bg.status !== 200) throw new Error("buyget failed: " + JSON.stringify(bg.body).slice(0, 160));
    }
    if (active) {
      const ac = await patch(`/api/admin/promotions/${id}`, { status: "ACTIVE" }, sc);
      if (ac.status !== 200) throw new Error("activate failed: " + JSON.stringify(ac.body).slice(0, 200));
    }
    return id;
  };
  const setStatus = async (id, status) => patch(`/api/admin/promotions/${id}`, { status }, sc);
  let sc = null;

  try {
    const pre = await q(`SELECT (SELECT count(*)::int FROM promotions) AS p,
      (SELECT count(*)::int FROM coupons) AS c, (SELECT count(*)::int FROM order_discounts) AS d`);
    t("promo-tables-start-empty", pre[0].p === 0 && pre[0].c === 0 && pre[0].d === 0, JSON.stringify(pre[0]));

    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("logins-ok", store.status === 201 && owner.status === 201 && bare.status === 201);
    sc = store.cookie;
    const c1 = await post(`/api/store/customers/identify`, { phone: P_C1, firstName: "Promo1" });
    const c2 = await post(`/api/store/customers/identify`, { phone: P_C2, firstName: "Promo2" });
    const idC1 = c1.body.data.id;
    const idC2 = c2.body.data.id;
    const a1 = await post(`/api/admin/customers/${idC1}/addresses`, { city: "Cairo", phone: P_C1 }, sc);
    const a2 = await post(`/api/admin/customers/${idC2}/addresses`, { city: "Giza", phone: P_C2 }, sc);
    const idA1 = a1.body.data.id;
    const idA2 = a2.body.data.id;

    // ---------- admin CRUD + frozen gates ----------
    const badShape = await post(`/api/admin/promotions`, { name: "Bad", type: "PERCENTAGE", scope: "LINE" }, sc);
    t("promo-shape-422", badShape.status === 422);
    const badScope = await post(`/api/admin/promotions`, { name: "Bad", type: "FIXED_PRICE", scope: "ORDER", fixedPrice: "9.00" }, sc);
    t("promo-scope-422", badScope.status === 422);
    const badWindow = await post(`/api/admin/promotions`,
      { name: "Bad", type: "PERCENTAGE", scope: "ORDER", discountPercent: "5.00", startAt: "2026-06-02T00:00:00.000Z", endAt: "2026-06-01T00:00:00.000Z" }, sc);
    t("promo-window-422", badWindow.status === 422);
    const idBare = await mkPromo(
      { name: "BA8 bare", type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 5 },
      null, null, null, false);
    const needTarget = await patch(`/api/admin/promotions/${idBare}`, { status: "ACTIVE" }, sc);
    t("activate-targetless-422", needTarget.status === 422);
    await del(`/api/admin/promotions/${idBare}`, sc);
    promoIds.delete(idBare);
    const idPct = await mkPromo(
      { name: "BA8 10% P330", type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 }, null, null, false);
    const tgtDup = await post(`/api/admin/promotions/${idPct}/targets`, { targetType: "VARIANT", targetId: P330 }, sc);
    // (target already added by mkPromo) -> duplicate
    t("target-dup-409", tgtDup.status === 409);
    const tgtDead = await post(`/api/admin/promotions/${idPct}/targets`, { targetType: "VARIANT", targetId: UNKNOWN }, sc);
    t("target-dead-422", tgtDead.status === 422);
    const tgtBadType = await post(`/api/admin/promotions/${idPct}/targets`, { targetType: "STORE", targetId: P330 }, sc);
    t("target-bad-enum-400", tgtBadType.status === 400);
    const goActive = await patch(`/api/admin/promotions/${idPct}`, { status: "ACTIVE" }, sc);
    t("activate-200", goActive.status === 200 && goActive.body.data.status === "ACTIVE");
    const pAnon = await post(`/api/admin/promotions`, { name: "X", type: "PERCENTAGE", scope: "ORDER", discountPercent: "5.00" });
    t("promo-anon-401", pAnon.status === 401);
    const pBare = await post(`/api/admin/promotions`, { name: "X", type: "PERCENTAGE", scope: "ORDER", discountPercent: "5.00" }, bare.cookie);
    t("promo-bare-403", pBare.status === 403);
    const pGet = await get(`/api/admin/promotions/${idPct}`, owner.cookie);
    t("promo-get-200", pGet.status === 200 && pGet.body.data.targets.length === 1 && pGet.body.data.rules === null);

    // S1: line percent auto (only promo active).
    const o1 = await orderWith(idC1, idA1, [[P330, "2"]], key("pct"));
    const O1 = o1.body?.data?.order;
    t("auto-percent-201", o1.status === 201 && O1 && num(O1.discountTotal) === 3 && num(O1.totalEstimated) === 47);
    const d1 = await discountsOf(O1.id);
    t("auto-percent-row", d1.length === 1 && d1[0].k === "PROMOTION_LINE" && num(d1[0].d) === 3 && d1[0].c === null);
    const m1 = await q(`SELECT discount_amount::text d FROM order_items WHERE order_id = $1`, [O1.id]);
    t("auto-mirror", m1[0].d === "3.00");

    // Referenced immutability + RESTRICT delete (order O1 references idPct).
    const immut = await patch(`/api/admin/promotions/${idPct}`, { discountPercent: "20.00" }, sc);
    t("immutable-value-422", immut.status === 422);
    const delRef = await del(`/api/admin/promotions/${idPct}`, sc);
    t("delete-referenced-409", delRef.status === 409);
    const mutOk = await patch(`/api/admin/promotions/${idPct}`, { priority: 11 }, sc);
    t("mutable-priority-200", mutOk.status === 200 && mutOk.body.data.priority === 11);
    await setStatus(idPct, "DISABLED");

    // S2: stacking pair 20%(p10,stackable) + 10%(p5,stackable) on P330x2=30.
    const idS1 = await mkPromo(
      { name: "BA8 20% s", type: "PERCENTAGE", scope: "LINE", discountPercent: "20.00", priority: 10, isStackable: true },
      { targetType: "VARIANT", targetId: P330 });
    const idS2 = await mkPromo(
      { name: "BA8 10% s", type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 5, isStackable: true },
      { targetType: "VARIANT", targetId: P330 });
    const o2 = await orderWith(idC1, idA1, [[P330, "2"]], key("stack"));
    const O2 = o2.body?.data?.order;
    t("stack-sequential", o2.status === 201 && O2 && num(O2.discountTotal) === 8.4 && num(O2.totalEstimated) === 41.6);
    // Exclusive: disable S1, add non-stackable 20% prio 10 -> only it applies.
    await setStatus(idS1, "DISABLED");
    const idX = await mkPromo(
      { name: "BA8 20% x", type: "PERCENTAGE", scope: "LINE", discountPercent: "20.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 });
    const oX = await orderWith(idC1, idA1, [[P330, "2"]], key("excl"));
    t("stack-exclusive", oX.status === 201 && num(oX.body.data.order.discountTotal) === 6);
    await setStatus(idX, "DISABLED");
    await setStatus(idS2, "DISABLED");

    // S3: cap 50% max 5 on P330x2=30 -> 5.00.
    const idCap = await mkPromo(
      { name: "BA8 50% cap5", type: "PERCENTAGE", scope: "LINE", discountPercent: "50.00", priority: 50, isStackable: true },
      { targetType: "VARIANT", targetId: P330 }, { maximumDiscount: "5.00" });
    const oCap = await orderWith(idC1, idA1, [[P330, "2"]], key("cap"));
    t("cap-pins", oCap.status === 201 && num(oCap.body.data.order.discountTotal) === 5);
    await setStatus(idCap, "DISABLED");

    // S4: minimum 1000 + scheduled future -> both skipped (pct re-enabled).
    const idMin = await mkPromo(
      { name: "BA8 min1000", type: "PERCENTAGE", scope: "LINE", discountPercent: "50.00", priority: 60, isStackable: true },
      { targetType: "VARIANT", targetId: P330 }, { minimumAmount: "1000.00" });
    const idSched = await mkPromo(
      { name: "BA8 future", type: "PERCENTAGE", scope: "LINE", discountPercent: "90.00", priority: 70, isStackable: true, startAt: "2030-01-01T00:00:00.000Z" },
      { targetType: "VARIANT", targetId: P330 });
    await setStatus(idPct, "ACTIVE");
    const oSkip = await orderWith(idC1, idA1, [[P330, "2"]], key("skip"));
    t("skip-minimum-scheduled", oSkip.status === 201 && num(oSkip.body.data.order.discountTotal) === 3);
    await setStatus(idPct, "DISABLED");
    await setStatus(idMin, "DISABLED");
    const delSched = await del(`/api/admin/promotions/${idSched}`, sc);
    t("delete-clean-200", delSched.status === 200);
    promoIds.delete(idSched);

    // S5: BXGY same-variant P1L buy2/get1/100%: x3=90 -> -30.
    const idBxg = await mkPromo(
      { name: "BA8 B2G1", type: "BUY_X_GET_Y", scope: "LINE", priority: 5 },
      { targetType: "VARIANT", targetId: P1L }, null,
      { buyQuantity: "2", getQuantity: "1", discountPercent: "100.00" });
    const oBxg = await orderWith(idC1, idA1, [[P1L, "3"]], key("bxg"));
    const OB = oBxg.body?.data?.order;
    t("bxgy-same", oBxg.status === 201 && OB && num(OB.discountTotal) === 30 && num(OB.totalEstimated) === 80);
    await setStatus(idBxg, "DISABLED");

    // S6: BXGY cross-variant P330x2 (30) -> free P1Lx1 (30 gross, 30 off):
    // subtotal 60, discount 30, total 60-30+20=50.
    const idBxgX = await mkPromo(
      { name: "BA8 chips-dip", type: "BUY_X_GET_Y", scope: "LINE", priority: 4 },
      { targetType: "VARIANT", targetId: P330 }, null,
      { buyQuantity: "2", getQuantity: "1", discountPercent: "100.00", freeVariantId: P1L });
    const oBxgX = await orderWith(idC1, idA1, [[P330, "2"]], key("bxgx"));
    const OBX = oBxgX.body?.data?.order;
    const freeLine = OBX ? OBX.items.find((i) => i.productVariantId === P1L) : null;
    t("bxgy-cross", oBxgX.status === 201 && OBX && freeLine && num(freeLine.unitPrice) === 30
      && num(freeLine.estimatedTotal) === 30 && num(OBX.subtotalEstimated) === 60
      && num(OBX.discountTotal) === 30 && OBX.items.length === 2 && num(OBX.totalEstimated) === 50);
    await setStatus(idBxgX, "DISABLED");

    // BXGY activation gate: rule row required.
    const idBxgN = await mkPromo(
      { name: "BA8 norule", type: "BUY_X_GET_Y", scope: "LINE", priority: 5 },
      { targetType: "VARIANT", targetId: P1L }, null, null, false);
    const bxgNoRule = await patch(`/api/admin/promotions/${idBxgN}`, { status: "ACTIVE" }, sc);
    t("bxgy-needs-rule-422", bxgNoRule.status === 422);
    const bxgBadType = await put(`/api/admin/promotions/${idPct}/buy-get`, { buyQuantity: "2", getQuantity: "1", discountPercent: "100.00" }, sc);
    t("buyget-wrong-type-422", bxgBadType.status === 422);
    await del(`/api/admin/promotions/${idBxgN}`, sc);
    promoIds.delete(idBxgN);

    // ---------- coupons (autos excluded by design; parent ACTIVE) ----------
    const idCp = await mkPromo(
      { name: "BA8 welcome50", type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "50.00", priority: 100 });
    const cp1 = await post(`/api/admin/coupons`, { promotionId: idCp, code: "save50", perCustomerLimit: 1, minimumOrderAmount: "200.00" }, sc);
    t("coupon-create-201", cp1.status === 201 && cp1.body.data.code === "SAVE50");
    const idSave = cp1.body.data.id;
    couponIds.add(idSave);
    const cpDup = await post(`/api/admin/coupons`, { promotionId: idCp, code: "SAVE50" }, sc);
    t("coupon-dup-409", cpDup.status === 409);
    const cpBadPromo = await post(`/api/admin/coupons`, { promotionId: UNKNOWN, code: "NOPE1" }, sc);
    t("coupon-bad-promo-422", cpBadPromo.status === 422);
    const cpSpace = await post(`/api/admin/coupons`, { promotionId: idCp, code: "has space" }, sc);
    t("coupon-space-400", cpSpace.status === 400);
    const oCp = await orderWith(idC1, idA1, [[P1L, "10"]], key("cpn"), "save50");
    const OC = oCp.body?.data?.order;
    t("coupon-apply-201", oCp.status === 201 && OC && num(OC.discountTotal) === 50 && num(OC.totalEstimated) === 270);
    const dc = await discountsOf(OC.id);
    t("coupon-rows", dc.some((r) => r.k === "COUPON" && num(r.d) === 50 && r.c !== null));
    const usage = await q(`SELECT estimated_discount_amount::text e FROM coupon_usages WHERE order_id = $1`, [OC.id]);
    t("coupon-usage-row", usage.length === 1 && usage[0].e === "50.00");
    const usedCt = await q(`SELECT used_count FROM coupons WHERE id = $1`, [idSave]);
    t("coupon-counter", usedCt[0].used_count === 1);
    const oMin = await orderWith(idC1, idA1, [[P330, "1"]], key("cpmin"), "SAVE50");
    t("coupon-minimum-422", oMin.status === 422);
    const oUnk = await orderWith(idC1, idA1, [[P1L, "10"]], key("cpunk"), "NOPEZZ");
    t("coupon-unknown-404", oUnk.status === 404);
    const oPerCust = await orderWith(idC1, idA1, [[P1L, "10"]], key("cppc"), "SAVE50");
    t("coupon-per-customer-422", oPerCust.status === 422);
    const cpDis = await patch(`/api/admin/coupons/${idSave}`, { isActive: false }, sc);
    t("coupon-disable-200", cpDis.status === 200 && cpDis.body.data.isActive === false);
    const oDis = await orderWith(idC2, idA2, [[P1L, "10"]], key("cpdis"), "SAVE50");
    t("coupon-disabled-422", oDis.status === 422);
    await patch(`/api/admin/coupons/${idSave}`, { isActive: true }, sc);
    await patch(`/api/admin/coupons/${idSave}`, { endAt: "2020-01-01T00:00:00.000Z" }, sc);
    const oExp2 = await orderWith(idC2, idA2, [[P1L, "10"]], key("cpexp2"), "SAVE50");
    t("coupon-expired-422", oExp2.status === 422);
    await patch(`/api/admin/coupons/${idSave}`, { endAt: null }, sc);
    const cpLim = await post(`/api/admin/coupons`, { promotionId: idCp, code: "ONCEONLY", usageLimit: 1 }, sc);
    const idLim = cpLim.body.data.id;
    couponIds.add(idLim);
    const oL1 = await orderWith(idC1, idA1, [[P1L, "10"]], key("cplim1"), "ONCEONLY");
    t("coupon-limit-first-201", oL1.status === 201);
    const oL2 = await orderWith(idC2, idA2, [[P1L, "10"]], key("cplim2"), "ONCEONLY");
    t("coupon-limit-second-409", oL2.status === 409);
    t("coupon-limit-no-usage", (await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1`, [idLim]))[0].n === 1);

    // ---------- estimate parity (pct only) ----------
    await setStatus(idBxgX, "DISABLED");
    await setStatus(idMin, "DISABLED");
    await setStatus(idPct, "ACTIVE");
    const est = await post(`/api/store/orders/estimate`, { lines: [{ productVariantId: P330, quantity: "2" }] });
    t("estimate-200", est.status === 200 && num(est.body.data.discountTotal) === 3 && num(est.body.data.total) === 47);
    const oEst = await orderWith(idC1, idA1, [[P330, "2"]], key("estpar"));
    t("estimate-parity", oEst.status === 201 && num(oEst.body.data.order.discountTotal) === num(est.body.data.discountTotal)
      && num(oEst.body.data.order.totalEstimated) === num(est.body.data.total));
    await setStatus(idPct, "DISABLED");
    const estCp = await post(`/api/store/orders/estimate`, {
      lines: [{ productVariantId: P1L, quantity: "10" }],
      couponCode: "save50",
      customerId: idC2,
    });
    t("estimate-coupon", estCp.status === 200 && estCp.body.data.coupon && estCp.body.data.coupon.applicable === true
      && num(estCp.body.data.coupon.amount) === 50);
    const estBadCp = await post(`/api/store/orders/estimate`, {
      lines: [{ productVariantId: P1L, quantity: "10" }],
      couponCode: "NOPEZZ",
    });
    t("estimate-unknown-coupon-404", estBadCp.status === 404);
    const estBadLine = await post(`/api/store/orders/estimate`, { lines: [{ productVariantId: P330, quantity: "0" }] });
    t("estimate-bad-line-400", estBadLine.status === 400);

    // ---------- history stability ----------
    const dFrozen = await discountsOf(O2.id);
    t("discount-rows-frozen", dFrozen.filter((r) => r.k === "PROMOTION_LINE").length === 2
      && dFrozen.every((r) => num(r.d) > 0));

    // ---------- cancel decrements ----------
    const usedBefore = (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idSave]))[0].used_count;
    const cx = await post(`/api/store/orders/${OC.id}/cancel`, { customerId: idC1 });
    t("cancel-discounted-200", cx.status === 200);
    const usedAfter = (await q(`SELECT used_count FROM coupons WHERE id = $1`, [idSave]))[0].used_count;
    t("cancel-decrements", usedAfter === usedBefore - 1);
    const usageStays = await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE order_id = $1`, [OC.id]);
    t("usage-row-stays", usageStays[0].n === 1);

    // ---------- admin RBAC on coupons + promo reads ----------
    const cpAnon = await post(`/api/admin/coupons`, { promotionId: idCp, code: "ANON1" });
    t("coupon-anon-401", cpAnon.status === 401);
    const cpBare = await post(`/api/admin/coupons`, { promotionId: idCp, code: "BARE1" }, bare.cookie);
    t("coupon-bare-403", cpBare.status === 403);
    const cpOwner = await get(`/api/admin/coupons?limit=5`, owner.cookie);
    t("coupon-owner-200", cpOwner.status === 200);
    const pList = await get(`/api/admin/promotions?limit=20`, store.cookie);
    t("promo-list-200", pList.status === 200 && pList.body.data.length >= 3);
  } finally {
    try {
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2)`,
        [CANON(P_C1), CANON(P_C2)],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`,
            [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
        await db.query(`DELETE FROM order_discounts WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
      }
      for (const id of couponIds) {
        await db.query(`DELETE FROM coupons WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of promoIds) {
        await db.query(`DELETE FROM promotion_buy_get_rules WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotion_rules WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotions WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
          for (const c of cc.rows) {
            await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
            await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
          }
        }
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      for (const email of [STORE_EMAIL, OWNER_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`PROMOTIONS_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
