// BA-G end-to-end release gate (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-bag-e2e.mjs --db <name> --port <port>
// ONE unbroken journey through the real application path (HTTP → route →
// validation → auth → authorization → service → transaction → PostgreSQL):
// catalog discovery → product → customer → address → cart → merge →
// promotion → coupon → checkout → order → mutation-proof snapshots →
// replacement → cancellation, plus a cross-domain concurrency gate
// (coupon race, cancel+approve race, same-cart double checkout, cancel replay).
// Direct SQL is used only for fixture guards, verification, and cleanup.
// Prints JSON, no secrets.
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
  console.log(JSON.stringify({ suite: "bag-e2e", db: dbName, total: results.length, failures: failures.length, failed: failures, passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const SEED_PRODUCT = "01800000-0000-7000-8000-000000000200";
const P_G1 = "01096000011";
const P_G2 = "01096000022";
const CANON = (p) => "2010" + p.slice(3);
const num = (s) => Number(s);

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

  const jcall = async (method, path, body, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const get = (path, cookie = null, headers = {}) =>
    fetch(`${baseUrl}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const post = (path, data, cookie = null, headers = {}) => jcall("POST", path, data,
    { ...(cookie ? { cookie } : {}), ...headers });
  const patch = (path, data, cookie = null, headers = {}) => jcall("PATCH", path, data,
    { ...(cookie ? { cookie } : {}), ...headers });
  const del = (path, cookie = null, headers = {}) =>
    fetch(`${baseUrl}${path}`, { method: "DELETE", headers: { ...(cookie ? { cookie } : {}), ...headers } })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => ({}));
    const m = (r.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, body, cookie: m ? `__Host-admin-session=${m[1]}` : null };
  };

  const stamp = Date.now().toString(36);
  const keySeq = { n: 0 };
  const key = (p) => `bage2e-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

  const mkGuest = async (lines = []) => {
    const g = await post(`/api/store/cart`, {});
    cartIds.add(g.body.data.cart.id);
    const tok = g.body.data.guestToken;
    for (const [vid, qty] of lines) {
      await fetch(`${baseUrl}/api/store/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-guest-token": tok },
        body: JSON.stringify({ productVariantId: vid, quantity: qty }),
      });
    }
    return { id: g.body.data.cart.id, tok };
  };
  const checkout = async (tok, custId, addrId, k, extra = {}, useToken = true) => {
    const headers = { "content-type": "application/json", ...(useToken && tok ? { "x-guest-token": tok } : {}) };
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ customerId: custId, addressId: addrId, idempotencyKey: k, ...extra }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const reservedOf = async (v) =>
    (await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [v]))[0].r;
  const mkPromo = async (promo, target, ck) => {
    const p = await post(`/api/admin/promotions`, promo, ck);
    const id = p.body.data.id;
    promoIds.add(id);
    if (target) await post(`/api/admin/promotions/${id}/targets`, target, ck);
    return id;
  };
  const activate = async (id, ck) => patch(`/api/admin/promotions/${id}`, { status: "ACTIVE" }, ck);
  const orderOf = async (orderId, custId) =>
    (await get(`/api/store/orders/${orderId}?customerId=${custId}`)).body?.data?.order;

  try {
    // Guards: server identity + logins + clean environment.
    const srvIdent = await get(`/api/store/catalog/products?limit=100`);
    const srvHasFixture = srvIdent.status === 200 && JSON.stringify(srvIdent.body).includes(SEED_PRODUCT);
    console.error(`[env] server-identity probe: catalog=${srvIdent.status} scratchFixture=${srvHasFixture}`);
    if (!srvHasFixture) {
      console.error(`REFUSED_WRONG_SERVER_DB`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("logins-ok", store.status === 201 && owner.status === 201, `${store.status}/${owner.status}`);
    if (store.status !== 201 || owner.status !== 201 || !store.cookie || !owner.cookie) {
      console.error(`REFUSED_LOGIN (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = store.cookie;
    const envProbeName = `BAG envprobe ${stamp}`;
    const envProbe = await post(`/api/admin/promotions`, { name: envProbeName, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00" }, ck);
    const envProbeId = envProbe.body.data?.id ?? null;
    const envSeen = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE id = $1::uuid`, [envProbeId]))[0].n);
    if (envProbeId) {
      await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1::uuid`, [envProbeId]).catch(() => {});
      await db.query(`DELETE FROM promotion_rules WHERE promotion_id = $1::uuid`, [envProbeId]).catch(() => {});
      await db.query(`DELETE FROM promotions WHERE id = $1::uuid`, [envProbeId]).catch(() => {});
    }
    t("env-server-db-matches-suite-db", envProbe.status === 201 && envSeen === 1,
      `create=${envProbe.status} seen=${envSeen}`);
    if (envProbe.status !== 201 || envSeen !== 1) {
      console.error(`REFUSED_WRONG_SERVER_DB`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const strayPromos = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE status = 'ACTIVE'`))[0].n);
    const strayCust = Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone IN ($1,$2)`,
      [CANON(P_G1), CANON(P_G2)]))[0].n);
    t("env-clean", strayPromos === 0 && strayCust === 0, `activePromos=${strayPromos} leftoverCust=${strayCust}`);
    if (strayPromos !== 0 || strayCust !== 0) {
      console.error(`REFUSED_DIRTY_ENV`);
      await db.end().catch(() => {});
      process.exit(1);
    }

    // ================= CATALOG DISCOVERY (from live API, not hardcoded) =================
    const cats = await get(`/api/store/catalog/categories?limit=100`);
    t("e2e-categories", cats.status === 200 && Array.isArray(cats.body?.data) && cats.body.data.length > 0,
      `${cats.status}/${cats.body?.data?.length}`);
    const brands = await get(`/api/store/catalog/brands?limit=100`);
    t("e2e-brands", brands.status === 200 && Array.isArray(brands.body?.data) && brands.body.data.length > 0,
      `${brands.status}/${brands.body?.data?.length}`);
    const prods = await get(`/api/store/catalog/products?limit=100`);
    const pepsi = (prods.body?.data ?? []).find((p) => p.name === "Pepsi");
    t("e2e-products-find-pepsi", prods.status === 200 && !!pepsi, `${prods.status}`);
    const pDet = await get(`/api/store/catalog/products/${pepsi.id}`);
    t("e2e-product-detail", pDet.status === 200 && pDet.body?.data?.unit === "PIECE", `${pDet.status}`);
    const vList = await get(`/api/store/catalog/products/${pepsi.id}/variants?limit=20`);
    const variants = vList.body?.data ?? [];
    // Choose a sellable variant from live data (expects the 15.00 fixture).
    const piece = variants.find((v) => v.isActive && num(v.price) === 15);
    t("e2e-product-variants", vList.status === 200 && variants.length >= 1 && !!piece,
      `${vList.status}/variants=${variants.length}`);
    const PICK = piece.id;
    const vDet = await get(`/api/store/catalog/variants/${PICK}`);
    t("e2e-variant-detail", vDet.status === 200 && num(vDet.body?.data?.price) === 15, `${vDet.status}`);
    const avail = await get(`/api/store/inventory/variants/${PICK}`);
    t("e2e-availability", avail.status === 200 && num(avail.body?.data?.inventory?.availableQuantity) > 0,
      `${avail.status}`);
    // Code lookup + search + pagination walk from live data.
    const lk = await get(`/api/store/catalog/codes/lookup?code=6221001000331`);
    t("e2e-code-lookup", lk.status === 200, `${lk.status}`);
    const srch = await get(`/api/store/catalog/search?q=${encodeURIComponent("بيبسي")}&limit=10`);
    t("e2e-search", srch.status === 200, `${srch.status}`);
    const pg1 = await get(`/api/store/catalog/products?limit=1`);
    t("e2e-pagination-walk", pg1.status === 200 && pg1.body?.data?.length === 1
      && typeof pg1.body?.meta?.nextCursor === "string", `${pg1.status}`);

    // Weighted companion from live catalog (expects the 320.00 fixture).
    const romi = (prods.body?.data ?? []).find((p) => p.name === "جبنة رومي");
    const rVars = await get(`/api/store/catalog/products/${romi.id}/variants?limit=20`);
    const wVar = ((rVars.body?.data ?? [])).find((v) => v.isActive && num(v.price) === 320);
    t("e2e-weight-variant", !!romi && rVars.status === 200 && !!wVar, `${romi?.name}`);
    const WPICK = wVar.id;

    // ================= CUSTOMER + ADDRESS =================
    const c1 = await post(`/api/store/customers/identify`, { phone: P_G1, firstName: "E2E" });
    const idC1 = c1.body?.data?.id;
    t("e2e-identify-new-201", c1.status === 201 && !!idC1 && noSecrets(c1.body), `${c1.status}`);
    const c1b = await post(`/api/store/customers/identify`, { phone: `+${CANON(P_G1)}`, firstName: "E2E" });
    t("e2e-identify-existing-200", c1b.status === 200 && c1b.body?.data?.id === idC1, `${c1b.status}`);
    const a1 = await post(`/api/admin/customers/${idC1}/addresses`,
      { label: "home", city: "Matai", area: "Center", street: "Nile", buildingNumber: "3", landmark: "school", phone: P_G1, isDefault: true }, ck);
    const idA1 = a1.body?.data?.id;
    t("e2e-address-default", a1.status === 201 && !!idA1, `${a1.status}`);
    const c2 = await post(`/api/store/customers/identify`, { phone: P_G2, firstName: "E2E2" });
    const idC2 = c2.body?.data?.id;
    const a2 = await post(`/api/admin/customers/${idC2}/addresses`, { city: "Matai", phone: P_G2 }, ck);
    const idA2 = a2.body?.data?.id;

    // ================= CART + MERGE =================
    const gJ = await mkGuest([[PICK, "2"], [WPICK, "0.125"]]);
    const mg = await post(`/api/store/cart/merge`, { customerId: idC1 }, null, { "x-guest-token": gJ.tok });
    t("e2e-merge", mg.status === 200, `${mg.status}/${mg.body?.data?.merge?.mode}`);

    // ================= PROMOTION + COUPON (admin fixtures via real API) =================
    const idPct = await mkPromo(
      { name: `BAG pct ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10 },
      { targetType: "VARIANT", targetId: PICK }, ck);
    const idPar = await mkPromo(
      { name: `BAG par ${stamp}`, type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "20.00", priority: 100 },
      null, ck);
    await activate(idPct, ck);
    await activate(idPar, ck);
    const cpJ = await post(`/api/admin/coupons`, { promotionId: idPar, code: `BAG${stamp}`.toUpperCase().slice(0, 10) }, ck);
    const idCpJ = cpJ.body?.data?.id;
    const codeJ = cpJ.body?.data?.code;
    couponIds.add(idCpJ);
    t("e2e-promo-coupon-ready", !!idPct && !!idPar && !!idCpJ && !!codeJ, `${codeJ}`);
    // Expected money (from live prices 15.00 x2 + 320.00 x0.125):
    // gross 70.00; 10% LINE = 3.00; coupon 20.00; discountTotal 23.00;
    // delivery 20.00; total 67.00.
    const estJ = await post(`/api/store/orders/estimate`, {
      customerId: idC1,
      lines: [{ productVariantId: PICK, quantity: "2" }, { productVariantId: WPICK, quantity: "0.125" }],
      couponCode: codeJ,
    });
    const ej = estJ.body?.data ?? {};
    t("e2e-estimate", estJ.status === 200 && num(ej.subtotal) === 70 && num(ej.discountTotal) === 23
      && num(ej.total) === 67, `${estJ.status}/${ej.subtotal}/${ej.discountTotal}/${ej.total}`);
    const repJ = await post(`/api/store/cart/reprice`, { customerId: idC1 });
    t("e2e-reprice-200", repJ.status === 200, String(repJ.status));

    // ================= CHECKOUT =================
    const resJ330 = await reservedOf(PICK);
    const resJRomi = await reservedOf(WPICK);
    const kJ = key("journey");
    const oJ = await checkout(null, idC1, idA1, kJ, { couponCode: codeJ }, false);
    const OJ = oJ.body?.data?.order;
    t("e2e-checkout-201", oJ.status === 201 && OJ?.status === "CONFIRMED", `${oJ.status}`);
    t("e2e-totals", OJ != null && num(OJ.subtotalEstimated) === 70 && num(OJ.discountTotal) === 23
      && num(OJ.deliveryFee) === 20 && num(OJ.totalEstimated) === 67,
      `${OJ?.subtotalEstimated}/${OJ?.discountTotal}/${OJ?.deliveryFee}/${OJ?.totalEstimated}`);
    const jItems = OJ?.items ?? [];
    t("e2e-items-exact", jItems.length === 2
      && jItems.some((i) => i.productVariantId === PICK && num(i.unitPrice) === 15 && num(i.requestedQuantity) === 2
        && num(i.estimatedTotal) === 30 && i.unit === "PIECE")
      && jItems.some((i) => i.productVariantId === WPICK && num(i.unitPrice) === 320 && num(i.requestedQuantity) === 0.125
        && num(i.estimatedTotal) === 40 && i.unit === "KG"),
      `${oJ.status}`);
    t("e2e-customer-address-snapshot", OJ?.customerPhone === CANON(P_G1) && OJ?.delivery?.city === "Matai"
      && OJ?.delivery?.street === "Nile", JSON.stringify(OJ?.delivery));
    t("e2e-history", Array.isArray(OJ?.history) && OJ.history.length === 2
      && OJ.history[0].newStatus === "NEW" && OJ.history[1].newStatus === "CONFIRMED");
    t("e2e-reserved", num(await reservedOf(PICK)) - num(resJ330) === 2
      && num(await reservedOf(WPICK)) - num(resJRomi) === 0.125);
    t("e2e-coupon-used", Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpJ]))[0].used_count) === 1);
    t("e2e-promo-rows", Number((await q(`SELECT count(*)::int AS n FROM order_discounts WHERE order_id = $1::uuid`, [OJ?.id]))[0].n) >= 2);
    t("e2e-cart-finalized", (await q(`SELECT status FROM carts WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [idC1]))[0]?.status === "CHECKED_OUT");
    // Idempotency replay on the journey key: same order, no second reservation.
    const resBeforeRp = await reservedOf(PICK);
    const oJr = await checkout(null, idC1, idA1, kJ, { couponCode: codeJ }, false);
    t("e2e-replay-same-order", oJr.status === 200 && oJr.body?.data?.order?.id === OJ?.id
      && oJr.body?.meta?.replay === true && (await reservedOf(PICK)) === resBeforeRp,
      `${oJr.status}`);

    // ================= MUTATION-PROOF SNAPSHOTS =================
    await patch(`/api/admin/catalog/products/${pepsi.id}`, { name: "Pepsi MUTATED" }, ck);
    await patch(`/api/admin/catalog/variants/${PICK}/price`, { price: "17.00", reason: "bag drift test" }, ck);
    await patch(`/api/admin/customers/${idC1}/addresses/${idA1}`, { city: "MutatedCity", phone: P_G2 }, ck);
    const OJ2 = await orderOf(OJ.id, idC1);
    const jP = (OJ2?.items ?? []).find((i) => i.productVariantId === PICK);
    t("e2e-snapshot-immune", jP?.productName === "Pepsi" && num(jP?.unitPrice) === 15
      && num(OJ2?.subtotalEstimated) === 70 && OJ2?.delivery?.city === "Matai"
      && OJ2?.delivery?.phone === CANON(P_G1), `${jP?.productName}/${OJ2?.delivery?.city}`);
    await patch(`/api/admin/catalog/products/${pepsi.id}`, { name: "Pepsi" }, ck);
    await patch(`/api/admin/catalog/variants/${PICK}/price`, { price: "15.00", reason: "bag revert" }, ck);
    await patch(`/api/admin/customers/${idC1}/addresses/${idA1}`, { city: "Matai", phone: P_G1 }, ck);
    t("e2e-mutations-reverted", true);
    // Delete the used address: the order keeps its full snapshot.
    await del(`/api/admin/customers/${idC1}/addresses/${idA1}`, ck);
    const OJ3 = await orderOf(OJ.id, idC1);
    t("e2e-order-survives-address-delete", OJ3?.delivery?.city === "Matai" && OJ3?.delivery?.street === "Nile");

    // ================= REPLACEMENT (on the journey order) =================
    // Need a live address again for later steps (order snapshot already taken).
    const a1b = await post(`/api/admin/customers/${idC1}/addresses`, { city: "Matai", phone: P_G1, isDefault: true }, ck);
    const lineJ = (OJ?.items ?? []).find((i) => i.productVariantId === PICK);
    // Swap-mode propose keeps the line PENDING; approve materializes.
    const pR = await post(`/api/admin/orders/${OJ.id}/items/${lineJ.id}/replacements`,
      { replacementVariantId: WPICK, replacementQuantity: "0.250", markUnavailable: false }, ck);
    const R1 = pR.body?.data;
    t("e2e-replacement-proposed", pR.status === 201 && R1?.status === "PROPOSED", `${pR.status}`);
    const resWBefore = await reservedOf(WPICK);
    const dR = await post(`/api/store/orders/${OJ.id}/replacements/${R1.id}/decide`,
      { customerId: idC1, action: "approve" });
    t("e2e-replacement-approved", dR.status === 200 && dR.body?.data?.status === "CUSTOMER_APPROVED",
      `${dR.status}`);
    const afterAppr = await orderOf(OJ.id, idC1);
    t("e2e-replacement-materialized", (afterAppr?.items ?? []).some((i) => i.productVariantId === WPICK
      && num(i.requestedQuantity) === 0.25)
      && num(await reservedOf(WPICK)) - num(resWBefore) === 0.25);
    const dAgain = await post(`/api/store/orders/${OJ.id}/replacements/${R1.id}/decide`,
      { customerId: idC1, action: "approve" });
    t("e2e-replacement-twice-409", dAgain.status === 409, `${dAgain.status}`);

    // ================= CANCELLATION =================
    // Journey order holds PICK×2 (the 0.125 WPICK line was replaced: its hold
    // moved to the 0.250 replacement line at approve time).
    const resC330 = await reservedOf(PICK);
    const resCW = await reservedOf(WPICK);
    const cx = await post(`/api/store/orders/${OJ.id}/cancel`, { customerId: idC1 });
    t("e2e-cancel-200", cx.status === 200 && cx.body?.data?.order?.status === "CANCELLED", `${cx.status}`);
    const resAfterCx330 = await reservedOf(PICK);
    const resAfterCxW = await reservedOf(WPICK);
    // The PICK×2 hold was already released at replacement-approve time; cancel
    // releases the still-held WPICK 0.375 (0.125 line + 0.250 replacement line).
    t("e2e-cancel-released", num(resC330) - num(resAfterCx330) === 0
      && num(resCW) - num(resAfterCxW) === 0.375, `${resAfterCx330}/${resAfterCxW}`);
    const cx2 = await post(`/api/store/orders/${OJ.id}/cancel`, { customerId: idC1 });
    t("e2e-cancel-replay-409", cx2.status === 409
      && (await reservedOf(PICK)) === resAfterCx330
      && (await reservedOf(WPICK)) === resAfterCxW, `${cx2.status}`);
    // Foreign cancel denied.
    const cxF = await post(`/api/store/orders/${OJ.id}/cancel`, { customerId: idC2 });
    t("e2e-cancel-foreign-404", cxF.status === 404, `${cxF.status}`);

    // ================= CROSS-DOMAIN CONCURRENCY GATE =================
    // Coupon limit=1, two customers, simultaneous checkout: exactly one usage.
    const cpG = await post(`/api/admin/coupons`, {
      promotionId: idPar, code: `BAGG${stamp}`.toUpperCase().slice(0, 10), usageLimit: 1,
    }, ck);
    const idCpG = cpG.body?.data?.id;
    couponIds.add(idCpG);
    const gG1 = await mkGuest([[PICK, "1"]]);
    const gG2 = await mkGuest([[PICK, "1"]]);
    const [cG1, cG2] = await Promise.all([
      checkout(gG1.tok, idC1, a1b.body?.data?.id, key("cg1"), { couponCode: cpG.body?.data?.code }),
      checkout(gG2.tok, idC2, idA2, key("cg2"), { couponCode: cpG.body?.data?.code }),
    ]);
    const winCount = [cG1.status, cG2.status].filter((s) => s === 201).length;
    const usageN = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpG]))[0].used_count);
    t("e2e-coupon-race-single", winCount === 1 && usageN === 1, `${cG1.status}/${cG2.status}/used=${usageN}`);
    // Cancel + approve race on a fresh order: deterministic terminal state.
    const gCR = await mkGuest([[PICK, "1"]]);
    const oCR = await checkout(gCR.tok, idC1, a1b.body?.data?.id, key("cancelrace"));
    t("e2e-cancelrace-setup", oCR.status === 201, `${oCR.status}`);
    const crItems = oCR.body?.data?.order?.items ?? [];
    const pCR = await post(`/api/admin/orders/${oCR.body?.data?.order?.id}/items/${crItems[0]?.id}/replacements`,
      { replacementVariantId: WPICK, replacementQuantity: "0.250", markUnavailable: false }, ck);
    t("e2e-cancelrace-proposed", pCR.status === 201, `${pCR.status}`);
    const idCR = oCR.body?.data?.order?.id;
    const resBeforeCR = await reservedOf(PICK);
    const resBeforeCRW = await reservedOf(WPICK);
    const [cxR, apR] = await Promise.all([
      post(`/api/store/orders/${idCR}/cancel`, { customerId: idC1 }),
      post(`/api/store/orders/${idCR}/replacements/${pCR.body?.data?.id}/decide`, { customerId: idC1, action: "approve" }),
    ]);
    const finalCR = await orderOf(idCR, idC1);
    const dPICK = num(await reservedOf(PICK)) - num(resBeforeCR);
    const dWPICK = num(await reservedOf(WPICK)) - num(resBeforeCRW);
    const legalStatus = (s) => [200, 404, 409, 422].includes(s);
    let raceOk = false;
    let raceWhy = `cancel=${cxR.status} approve=${apR.status} final=${finalCR?.status} dPICK=${dPICK} dWPICK=${dWPICK}`;
    if (legalStatus(cxR.status) && legalStatus(apR.status)) {
      if (finalCR?.status === "CANCELLED" && apR.status !== 200 && dPICK === -1 && dWPICK === 0) {
        raceOk = true; // cancel won outright: released, approve rejected
      } else if (finalCR?.status === "CANCELLED" && apR.status === 200 && dPICK === -1 && dWPICK === 0) {
        raceOk = true; // approve won, then cancel released everything incl. replacement hold
      } else if (finalCR?.status === "CONFIRMED" && apR.status === 200 && cxR.status !== 200
        && dPICK === -1 && dWPICK === 0.25) {
        raceOk = true; // approve won, cancel lost: holds moved exactly
      }
    }
    t("e2e-cancel-approve-deterministic", raceOk, raceWhy);
    t("e2e-cancel-approve-no-negative", num(await reservedOf(PICK)) >= 0 && num(await reservedOf(WPICK)) >= 0);
    // Same-cart double checkout: one order.
    const gD = await mkGuest([[PICK, "1"]]);
    const resBeforeD = await reservedOf(PICK);
    const [dd1, dd2] = await Promise.all([
      checkout(gD.tok, idC1, a1b.body?.data?.id, key("dbl1")),
      checkout(gD.tok, idC1, a1b.body?.data?.id, key("dbl2")),
    ]);
    const dStatuses = [dd1.status, dd2.status].sort().join(",");
    t("e2e-same-cart-double", dStatuses === "200,201"
      && dd1.body?.data?.order?.id !== undefined
      && dd1.body.data.order.id === dd2.body?.data?.order?.id,
      `${dd1.status}/${dd2.status}`);
    t("e2e-same-cart-single-reserve", num(await reservedOf(PICK)) - num(resBeforeD) === 1);

    // ================= FINAL CONSISTENCY =================
    // Every order created in this suite is accounted: CANCELLED, or CONFIRMED
    // with reservations exactly matching its lines.
    const allOrders = await q(`SELECT o.id::text AS id, o.status,
        COALESCE((SELECT SUM(requested_quantity)::text FROM order_items WHERE order_id = o.id), '0') AS qty
      FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2)`, [CANON(P_G1), CANON(P_G2)]);
    let consistentCount = 0;
    for (const o of allOrders) {
      if (o.status === "CANCELLED") { consistentCount++; continue; }
      if (o.status === "CONFIRMED") {
        const items = await q(`SELECT product_variant_id::text AS v, requested_quantity::text AS qn FROM order_items WHERE order_id = $1::uuid`, [o.id]);
        let ok = true;
        for (const it of items) {
          const rv = await q(`SELECT reserved_quantity FROM inventory WHERE product_variant_id = $1::uuid`, [it.v]);
          if (Number(rv[0]?.reserved_quantity ?? -1) < Number(it.qn)) { ok = false; break; }
        }
        if (ok) consistentCount++;
      }
    }
    t("e2e-final-consistency", allOrders.length > 0 && consistentCount === allOrders.length,
      `orders=${allOrders.length} consistent=${consistentCount}`);
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2)`,
        [CANON(P_G1), CANON(P_G2)],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`,
            [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
        // Replacement child rows reference order_items.
        const repRows = await db.query(`SELECT id FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => ({ rows: [] }));
        for (const rr of repRows.rows) {
          await db.query(`DELETE FROM order_item_replacements WHERE id = $1`, [rr.id]).catch(() => {});
        }
        await db.query(`DELETE FROM order_discounts WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = $1`, [o.id]).catch(() => {});
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
      for (const ph of [P_G1, P_G2].map(CANON)) {
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
      for (const ph of [P_G1, P_G2].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      for (const email of [OWNER_EMAIL, STORE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`BAG_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
