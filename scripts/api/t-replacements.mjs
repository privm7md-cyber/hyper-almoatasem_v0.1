// BA-7 replacements API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-replacements.mjs --db <name> --port <port>
// Covers: staff propose (OOS flip + swap mode + guards), storefront
// approve/reject (materialization, link-not-overwrite, holds), withdraw,
// R5 auto-accept (consent + caps), ownership scoping, RBAC matrix,
// snapshot immutability, READY-gate visibility. Frozen fixtures read-only;
// all orders/customers created here are removed in cleanup (reservations
// released first — BA-7 never picks, so every hold equals its request).
// Prints JSON, never secrets.
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
  console.log(JSON.stringify({ suite: "replacements", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P25L = "01800000-0000-7000-8000-000000000203";
const ROMI_V = "01800000-0000-7000-8000-000000000101";
const UNKNOWN = "04800000-0000-7000-8000-000000009999";
const P_C1 = "01093000011";
const P_C2 = "01093000022";
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

  const get = async (path) => {
    const r = await fetch(`${baseUrl}${path}`);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // Storefront POSTs: guest bearer travels in x-guest-token (cart/order scope).
  const post = async (path, data, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  // Admin POSTs: session cookie (nullish = anonymous).
  const apost = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
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
  const loginGet = async (path, cookie) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const num = (s) => Number(s);
  const keySeq = { n: 0 };
  const key = (p) => `ba7-${p}-${Date.now().toString(36)}-${keySeq.n++}`;
  const cartIds = new Set();
  const mkGuestCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body.data.guestToken;
    const cartId = g.body.data.cart.id;
    cartIds.add(cartId);
    for (const [vid, qty] of lines) await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, tok);
    return { id: cartId, token: tok };
  };
  const mkOrder = async (custId, addrId, lines, k) => {
    const cart = await mkGuestCart(lines);
    const o = await post(`/api/store/orders`, { customerId: custId, addressId: addrId, idempotencyKey: k }, cart.token);
    return { order: o.body?.data?.order, status: o.status, cart };
  };
  const orderItemsOf = async (orderId, custId) =>
    (await get(`/api/store/orders/${orderId}?customerId=${custId}`)).body?.data?.order?.items ?? [];
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;

  try {
    // ---------- guards ----------
    const px = await q(`SELECT id, price::text p FROM product_variants WHERE id IN ($1,$2,$3)`, [P330, P1L, ROMI_V]);
    const pmap = Object.fromEntries(px.map((r) => [r.id, r.p]));
    t("fixture-prices", pmap[P330] === "15.00" && pmap[P1L] === "30.00" && pmap[ROMI_V] === "320.00", JSON.stringify(pmap));

    const c1 = await post(`/api/store/customers/identify`, { phone: P_C1, firstName: "Rep1" });
    const c2 = await post(`/api/store/customers/identify`, { phone: P_C2, firstName: "Rep2" });
    const idC1 = c1.body.data.id;
    const idC2 = c2.body.data.id;
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("logins-ok", store.status === 200 && owner.status === 200 && bare.status === 200);
    const a1 = await apost(`/api/admin/customers/${idC1}/addresses`,
      { city: "Cairo", phone: P_C1, isDefault: true }, store.cookie);
    const idA1 = a1.body.data.id;

    // ---------- propose: OOS path ----------
    const o1 = await mkOrder(idC1, idA1, [[P330, "2"]], key("o1"));
    t("order-ready", o1.status === 201);
    const items1 = await orderItemsOf(o1.order.id, idC1);
    const line330 = items1.find((i) => i.productVariantId === P330);
    const resP1LBefore = await reservedOf(P1L);
    const p1 = await apost(`/api/admin/orders/${o1.order.id}/items/${line330.id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1", reason: "330 OOS" }, store.cookie);
    trackRep(p1.body);
    const R1 = p1.body?.data;
    t("propose-201", p1.status === 201 && R1 && R1.status === "PROPOSED" && R1.proposedByType === "STAFF"
      && num(R1.replacementUnitPrice) === 30 && num(R1.priceDifference) === 0);
    const afterProp = await orderItemsOf(o1.order.id, idC1);
    t("propose-flips-unavailable", afterProp.find((i) => i.id === line330.id).itemStatus === "UNAVAILABLE");
    t("propose-no-inventory", (await reservedOf(P1L)) === resP1LBefore);
    t("propose-original-intact", afterProp.find((i) => i.id === line330.id).unitPrice === "15"
      && afterProp.find((i) => i.id === line330.id).productCode === "6221001000331");

    // ---------- propose: swap mode + guards ----------
    const oS = await mkOrder(idC1, idA1, [[P330, "1"]], key("oS"));
    const itemsS = await orderItemsOf(oS.order.id, idC1);
    const pS = await apost(`/api/admin/orders/${oS.order.id}/items/${itemsS[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1", markUnavailable: false }, store.cookie);
    trackRep(pS.body);
    const afterSwap = await orderItemsOf(oS.order.id, idC1);
    t("propose-swap-keeps-pending", pS.status === 201 && afterSwap.find((i) => i.id === itemsS[0].id).itemStatus === "PENDING");
    const pDup = await apost(`/api/admin/orders/${oS.order.id}/items/${itemsS[0].id}/replacements`,
      { replacementVariantId: ROMI_V, replacementQuantity: "0.250" }, store.cookie);
    t("propose-duplicate-409", pDup.status === 409);
    const pMissOrd = await apost(`/api/admin/orders/${UNKNOWN}/items/${itemsS[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    t("propose-unknown-order-404", pMissOrd.status === 404);
    const o2 = await mkOrder(idC1, idA1, [[P330, "1"]], key("o2"));
    const items2 = await orderItemsOf(o2.order.id, idC1);
    const pCross = await apost(`/api/admin/orders/${o1.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    t("propose-cross-order-404", pCross.status === 404);
    const pBadVar = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: UNKNOWN, replacementQuantity: "1" }, store.cookie);
    t("propose-unknown-variant-404", pBadVar.status === 404);
    const pZero = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "0" }, store.cookie);
    t("propose-zero-400", pZero.status === 400);
    const pFrac = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P330, replacementQuantity: "0.5" }, store.cookie);
    t("propose-fraction-422", pFrac.status === 422);
    const pStep = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: ROMI_V, replacementQuantity: "0.100" }, store.cookie);
    t("propose-step-422", pStep.status === 422);
    const pExtra = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1", governorate: "x" }, store.cookie);
    t("propose-strict-400", pExtra.status === 400);
    await db.query(`UPDATE product_variants SET is_active = FALSE WHERE id = $1`, [P25L]);
    const pOff = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P25L, replacementQuantity: "1" }, store.cookie);
    t("propose-inactive-sub-422", pOff.status === 422);
    await db.query(`UPDATE product_variants SET is_active = TRUE WHERE id = $1`, [P25L]);
    const pAnon = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" });
    t("propose-anon-401", pAnon.status === 401);
    const pBare = await apost(`/api/admin/orders/${o2.order.id}/items/${items2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, bare.cookie);
    t("propose-bare-403", pBare.status === 403);

    // ---------- storefront approve (R10 materialization) ----------
    const resBeforeApprove = await reservedOf(P330);
    const d1 = await post(`/api/store/orders/${o1.order.id}/replacements/${R1.id}/decide`,
      { customerId: idC1, action: "approve" });
    const D1 = d1.body?.data;
    t("approve-200", d1.status === 200 && D1.status === "CUSTOMER_APPROVED" && D1.decidedByType === "CUSTOMER"
      && !!D1.replacementOrderItemId);
    const afterAppr = await orderItemsOf(o1.order.id, idC1);
    const orig = afterAppr.find((i) => i.id === line330.id);
    const sub = afterAppr.find((i) => i.id === D1.replacementOrderItemId);
    t("approve-original-replaced", orig.itemStatus === "REPLACED" && orig.unitPrice === "15"
      && orig.productCode === "6221001000331");
    t("approve-new-line", !!sub && sub.productVariantId === P1L && num(sub.unitPrice) === 30
      && num(sub.requestedQuantity) === 1 && num(sub.estimatedTotal) === 30
      && sub.itemStatus === "PENDING" && sub.unit === "PIECE");
    t("approve-holds", (await reservedOf(P1L)) === "1.000"
      && num(resBeforeApprove) - num(await reservedOf(P330)) === 2);
    const dAgain = await post(`/api/store/orders/${o1.order.id}/replacements/${R1.id}/decide`,
      { customerId: idC1, action: "approve" });
    t("approve-twice-409", dAgain.status === 409);
    const pAfterRepl = await apost(`/api/admin/orders/${o1.order.id}/items/${line330.id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    t("propose-on-replaced-409", pAfterRepl.status === 409);

    // ---------- storefront reject ----------
    const dR = await post(`/api/store/orders/${oS.order.id}/replacements/${pS.body.data.id}/decide`,
      { customerId: idC1, action: "reject" });
    t("reject-200", dR.status === 200 && dR.body.data.status === "CUSTOMER_REJECTED"
      && dR.body.data.replacementOrderItemId === null);
    const afterRej = await orderItemsOf(oS.order.id, idC1);
    t("reject-no-line", afterRej.length === 1 && afterRej[0].itemStatus === "PENDING");
    t("reject-no-inventory", (await reservedOf(P1L)) === "1.000");
    const dForeign = await post(`/api/store/orders/${oS.order.id}/replacements/${pS.body.data.id}/decide`,
      { customerId: idC2, action: "approve" });
    t("decide-foreign-404", dForeign.status === 404);
    const dBadAct = await post(`/api/store/orders/${oS.order.id}/replacements/${pS.body.data.id}/decide`,
      { customerId: idC1, action: "withdraw" });
    t("decide-bad-action-400", dBadAct.status === 400);

    // ---------- withdraw (staff) ----------
    const oW = await mkOrder(idC1, idA1, [[P330, "1"]], key("oW"));
    const itemsW = await orderItemsOf(oW.order.id, idC1);
    const pW = await apost(`/api/admin/orders/${oW.order.id}/items/${itemsW[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1", reason: "oos?" }, store.cookie);
    trackRep(pW.body);
    const w1 = await apost(`/api/admin/replacements/${pW.body.data.id}/withdraw`, {}, store.cookie);
    t("withdraw-200", w1.status === 200 && w1.body.data.status === "CUSTOMER_REJECTED"
      && w1.body.data.decidedByType === "STAFF");
    const wAgain = await apost(`/api/admin/replacements/${pW.body.data.id}/withdraw`, {}, store.cookie);
    t("withdraw-twice-409", wAgain.status === 409);
    const wMiss = await apost(`/api/admin/replacements/${UNKNOWN}/withdraw`, {}, store.cookie);
    t("withdraw-unknown-404", wMiss.status === 404);
    // Re-proposal on the still-UNAVAILABLE original (sequential flow).
    const pW2 = await apost(`/api/admin/orders/${oW.order.id}/items/${itemsW[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "2" }, store.cookie);
    trackRep(pW2.body);
    t("repropose-after-withdraw-201", pW2.status === 201);

    // ---------- auto-accept (R5) ----------
    const consent = await (async () => {
      const r = await fetch(`${baseUrl}/api/admin/customers/${idC1}`, {
        method: "PATCH", headers: { "content-type": "application/json", cookie: store.cookie },
        body: JSON.stringify({ autoAcceptReplacements: true }),
      });
      return r.status;
    })();
    t("consent-on", consent === 200);
    // Cheap delta (0.000): covered.
    const oA = await mkOrder(idC1, idA1, [[P330, "2"]], key("oA"));
    const itemsA = await orderItemsOf(oA.order.id, idC1);
    const pA = await apost(`/api/admin/orders/${oA.order.id}/items/${itemsA[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    trackRep(pA.body);
    const aa = await apost(`/api/admin/replacements/${pA.body.data.id}/auto-accept`, {}, store.cookie);
    t("auto-accept-covered-200", aa.status === 200 && aa.body.data.status === "AUTO_ACCEPTED"
      && aa.body.data.decidedByType === "SYSTEM" && !!aa.body.data.replacementOrderItemId);
    // No consent (C2): 422.
    const aN = await apost(`/api/admin/customers/${idC2}/addresses`, { city: "Giza", phone: P_C2 }, store.cookie);
    const idA2 = aN.body.data.id;
    const oN2 = await mkOrder(idC2, idA2, [[P330, "1"]], key("oN2"));
    const itemsN2 = await orderItemsOf(oN2.order.id, idC2);
    const pN = await apost(`/api/admin/orders/${oN2.order.id}/items/${itemsN2[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    trackRep(pN.body);
    const aaN = await apost(`/api/admin/replacements/${pN.body.data.id}/auto-accept`, {}, store.cookie);
    t("auto-accept-no-consent-422", aaN.status === 422);
    // Over caps (P25L x5 = 275 vs 30): 422 even with consent.
    const oE = await mkOrder(idC1, idA1, [[P330, "2"]], key("oE"));
    const itemsE = await orderItemsOf(oE.order.id, idC1);
    const pE = await apost(`/api/admin/orders/${oE.order.id}/items/${itemsE[0].id}/replacements`,
      { replacementVariantId: P25L, replacementQuantity: "5" }, store.cookie);
    trackRep(pE.body);
    t("expensive-diff", num(pE.body.data.priceDifference) === 245);
    const aaE = await apost(`/api/admin/replacements/${pE.body.data.id}/auto-accept`, {}, store.cookie);
    t("auto-accept-over-cap-422", aaE.status === 422);
    const aaMiss = await apost(`/api/admin/replacements/${UNKNOWN}/auto-accept`, {}, store.cookie);
    t("auto-accept-unknown-404", aaMiss.status === 404);

    // ---------- lists + RBAC ----------
    const sList = await get(`/api/store/orders/${oA.order.id}/replacements?customerId=${idC1}`);
    t("store-list-200", sList.status === 200 && Array.isArray(sList.body.data) && sList.body.data.length >= 1);
    const sForeign = await get(`/api/store/orders/${oA.order.id}/replacements?customerId=${idC2}`);
    t("store-list-foreign-404", sForeign.status === 404);
    const aList = await loginGet(`/api/admin/orders/${oA.order.id}/replacements`, store.cookie);
    t("admin-list-200", aList.status === 200 && aList.body.data.length >= 1);
    const aListMiss = await loginGet(`/api/admin/orders/${UNKNOWN}/replacements`, store.cookie);
    t("admin-list-unknown-404", aListMiss.status === 404);
    const aListAnon = await get(`/api/admin/orders/${oA.order.id}/replacements`);
    t("admin-list-anon-401", aListAnon.status === 401);
    const aListBare = await loginGet(`/api/admin/orders/${oA.order.id}/replacements`, bare.cookie);
    t("admin-list-bare-403", aListBare.status === 403);
    const aOwner = await loginGet(`/api/admin/orders/${oA.order.id}/replacements`, owner.cookie);
    t("admin-owner-200", aOwner.status === 200);

    // ---------- snapshot immunity (catalog moves, history frozen) ----------
    const bump = await (async () => {
      const r = await fetch(`${baseUrl}/api/admin/catalog/variants/${P1L}/price`, {
        method: "PATCH", headers: { "content-type": "application/json", cookie: store.cookie },
        body: JSON.stringify({ price: "33.00", reason: "ba7 test" }),
      });
      return r.status;
    })();
    t("price-bump-ok", bump === 200);
    const frozen = await get(`/api/store/orders/${o1.order.id}/replacements?customerId=${idC1}`);
    const fr = frozen.body.data.find((x) => x.id === R1.id);
    t("replacement-price-frozen", frozen.status === 200 && num(fr.replacementUnitPrice) === 30 && num(fr.priceDifference) === 0);
    const orderKept = await get(`/api/store/orders/${o1.order.id}?customerId=${idC1}`);
    t("order-lines-frozen", orderKept.status === 200
      && num(orderKept.body.data.order.items.find((i) => i.productVariantId === P330).unitPrice) === 15);
    await fetch(`${baseUrl}/api/admin/catalog/variants/${P1L}/price`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: store.cookie },
      body: JSON.stringify({ price: "30.00", reason: "ba7 revert" }),
    });

    // ---------- READY-gate visibility (R2 discipline input) ----------
    const oG = await mkOrder(idC1, idA1, [[P330, "1"]], key("oG"));
    const itemsG = await orderItemsOf(oG.order.id, idC1);
    const pG = await apost(`/api/admin/orders/${oG.order.id}/items/${itemsG[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    trackRep(pG.body);
    const gateView = await loginGet(`/api/admin/orders/${oG.order.id}/replacements`, store.cookie);
    t("ready-gate-visible", gateView.status === 200
      && gateView.body.data.some((x) => x.status === "PROPOSED"));

    // ---------- cancel interplay ----------
    const oX = await mkOrder(idC1, idA1, [[P330, "1"]], key("oX"));
    const itemsX = await orderItemsOf(oX.order.id, idC1);
    const pX = await apost(`/api/admin/orders/${oX.order.id}/items/${itemsX[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    trackRep(pX.body);
    const cxX = await post(`/api/store/orders/${oX.order.id}/cancel`, { customerId: idC1 });
    t("cancel-with-proposed-200", cxX.status === 200 && cxX.body.data.order.status === "CANCELLED");
    const dAfterCancel = await post(`/api/store/orders/${oX.order.id}/replacements/${pX.body.data.id}/decide`,
      { customerId: idC1, action: "approve" });
    t("approve-after-cancel-409", dAfterCancel.status === 409);
    const pAfterCancel = await apost(`/api/admin/orders/${oX.order.id}/items/${itemsX[0].id}/replacements`,
      { replacementVariantId: P1L, replacementQuantity: "1" }, store.cookie);
    t("propose-on-cancelled-409", pAfterCancel.status === 409);
  } finally {
    // Hygiene: release holds + remove BA-7 rows (replacements -> items ->
    // history -> orders -> carts -> customers). BA-7 never picks, so every
    // hold equals its requested quantity.
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
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
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

function trackRep() { /* ids resolved from responses inline; no global registry needed */ }

main().catch((e) => {
  console.error(`REPLACEMENTS_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
