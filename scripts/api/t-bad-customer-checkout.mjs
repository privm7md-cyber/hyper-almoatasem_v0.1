// BA-D customer + addresses + checkout verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-bad-customer-checkout.mjs --db <name> --port <port>
// Covers the BA-D shopping contract end to end through the REAL application
// service (no test doubles on the checkout path): customer identify/create/
// equivalence/normalization + 8-way same-phone race + identity race at
// checkout time, address CRUD + ownership + default switch + delete-default
// state + default-switch race, guest->customer upgrade via merge, the full
// journey (identify -> addresses -> guest cart -> merge -> piece+weight ->
// promotion -> coupon -> estimate -> reprice -> checkout) with exact money,
// weighted 0.125 kg order math, product/address snapshot immunity, address
// mutation races during checkout (torn-read safety), failed-key reuse, and
// the frozen phone-identity binding behavior. Prints JSON, no secrets.
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
  console.log(JSON.stringify({ suite: "bad-customer-checkout", db: dbName, total: results.length, failures: failures.length, failed: failures, passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const P330 = "01800000-0000-7000-8000-000000000201";
const SEED_PRODUCT = "01800000-0000-7000-8000-000000000200";
const ROMI_V = "01800000-0000-7000-8000-000000000101";
const PEPSI_PROD = "01800000-0000-7000-8000-000000000200";
const P_D1 = "01094000011";
const P_D2 = "01094000022";
const P_D3 = "01094000033";
const P_D4 = "01094000044";
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
  const key = (p) => `bad-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

  // Guest cart helper (tracks for cleanup).
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

  try {
    // Fail-closed server identity guard (same rationale as t-bac-shopping):
    // the seeded Pepsi product exists ONLY on scratch.
    const srvIdent = await get(`/api/store/catalog/products?limit=100`);
    const srvHasFixture = srvIdent.status === 200 && JSON.stringify(srvIdent.body).includes(SEED_PRODUCT);
    console.error(`[env] server-identity probe: catalog=${srvIdent.status} scratchFixture=${srvHasFixture}`);
    if (!srvHasFixture) {
      console.error(`REFUSED_WRONG_SERVER_DB: the API server on ${baseUrl} does not expose the scratch fixture.`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    t("logins-ok", store.status === 201 && !!store.cookie, String(store.status));
    if (store.status !== 201 || !store.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status} (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = store.cookie;
    // Post-login round-trip: the server's writes must be visible to this connection.
    const envProbeName = `BAD envprobe ${stamp}`;
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
    // Stray-state guard: no ACTIVE promos, no leftover BA-D customers.
    const strayPromos = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE status = 'ACTIVE'`))[0].n);
    const strayCust = Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone IN ($1,$2,$3,$4)`,
      [CANON(P_D1), CANON(P_D2), CANON(P_D3), CANON(P_D4)]))[0].n);
    t("env-clean", strayPromos === 0 && strayCust === 0, `activePromos=${strayPromos} leftoverCust=${strayCust}`);
    if (strayPromos !== 0 || strayCust !== 0) {
      console.error(`REFUSED_DIRTY_ENV`);
      await db.end().catch(() => {});
      process.exit(1);
    }

    // ================= CUSTOMER IDENTITY =================
    const c1 = await post(`/api/store/customers/identify`, { phone: P_D1, firstName: "BadOne" });
    const idC1 = c1.body?.data?.id;
    t("id-new-201", c1.status === 201 && !!idC1 && noSecrets(c1.body), `${c1.status}/${idC1}`);
    const c1b = await post(`/api/store/customers/identify`, { phone: P_D1, firstName: "BadOne" });
    t("id-existing-200", c1b.status === 200 && c1b.body?.data?.id === idC1, `${c1b.status}`);
    const cEq = await Promise.all([
      post(`/api/store/customers/identify`, { phone: `+${CANON(P_D1)}`, firstName: "BadOne" }),
      post(`/api/store/customers/identify`, { phone: CANON(P_D1), firstName: "BadOne" }),
    ]);
    t("id-equivalence", cEq.every((r) => r.body?.data?.id === idC1), JSON.stringify(cEq.map((r) => r.status)));
    const cBadL = await post(`/api/store/customers/identify`, { phone: "01234ABCD", firstName: "Bad" });
    t("id-bad-ladder-422", cBadL.status === 422, String(cBadL.status));
    const cBlank = await post(`/api/store/customers/identify`, { phone: "   ", firstName: "Bad" });
    t("id-blank-400", cBlank.status === 400, String(cBlank.status));
    // 8-way same-phone race: exactly one logical customer.
    const race8 = await Promise.all(Array.from({ length: 8 }, () =>
      post(`/api/store/customers/identify`, { phone: P_D3, firstName: "Race8" })));
    const race8Ids = race8.map((r) => r.body?.data?.id);
    const race8Statuses = race8.map((r) => r.status).sort().join(",");
    t("id-race8-all-success", race8.every((r) => r.status === 200 || r.status === 201), race8Statuses);
    t("id-race8-one-id", race8Ids[0] !== undefined && race8Ids.every((id) => id === race8Ids[0]));
    t("id-race8-single-row", Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone = $1`, [CANON(P_D3)]))[0].n) === 1);

    // ================= ADDRESSES =================
    // Need a second customer for cross-ownership checks.
    const c2 = await post(`/api/store/customers/identify`, { phone: P_D2, firstName: "BadTwo" });
    const idC2 = c2.body?.data?.id;
    const a1 = await post(`/api/admin/customers/${idC1}/addresses`,
      { label: "home", city: "Matai", area: "Center", street: "Main", buildingNumber: "7", landmark: "mosque", phone: P_D1, isDefault: true }, ck);
    const a2 = await post(`/api/admin/customers/${idC1}/addresses`,
      { city: "Matai", phone: P_D1 }, ck);
    const idA1 = a1.body?.data?.id;
    const idA2 = a2.body?.data?.id;
    t("addr-create-2", a1.status === 201 && a2.status === 201 && !!idA1 && !!idA2, `${a1.status}/${a2.status}`);
    const listed = await get(`/api/admin/customers/${idC1}/addresses`, ck);
    const listedArr = listed.body?.data ?? [];
    t("addr-default-first", listed.status === 200 && listedArr.length === 2
      && listedArr[0].id === idA1 && listedArr[0].isDefault === true, `${listed.status}`);
    const agov = await post(`/api/admin/customers/${idC1}/addresses`,
      { city: "Matai", phone: P_D1, governorate: "Minya" }, ck);
    t("addr-strict-400", agov.status === 400, String(agov.status));
    const sw = await patch(`/api/admin/customers/${idC1}/addresses/${idA2}`, { isDefault: true }, ck);
    const afterSw = await get(`/api/admin/customers/${idC1}/addresses`, ck);
    const defs = (afterSw.body?.data ?? []).filter((a) => a.isDefault === true);
    t("addr-switch-one", sw.status === 200 && defs.length === 1 && defs[0].id === idA2,
      `${sw.status}/defaults=${defs.length}`);
    const upd = await patch(`/api/admin/customers/${idC1}/addresses/${idA2}`, { city: "Samalut", landmark: null }, ck);
    t("addr-update-200", upd.status === 200 && upd.body?.data?.city === "Samalut" && upd.body?.data?.landmark === null,
      `${upd.status}/${upd.body?.data?.city}`);
    // Cross-customer access never leaks existence.
    const crossGet = await get(`/api/admin/customers/${idC2}/addresses/${idA2}`, ck);
    t("addr-cross-404", crossGet.status === 404, String(crossGet.status));
    // Checkout with another customer's address: deterministic 404, no side effects.
    const gX = await mkGuest([[P330, "1"]]);
    const resBeforeX = await reservedOf(P330);
    const crossCo = await checkout(gX.tok, idC2, idA2, key("xaddr"));
    t("checkout-cross-address-404", crossCo.status === 404
      && (await reservedOf(P330)) === resBeforeX
      && (await get(`/api/store/cart`, null, { "x-guest-token": gX.tok })).status === 200, `${crossCo.status}`);
    // Delete the CURRENT default: allowed, zero defaults remain, new default settable.
    const delDef = await del(`/api/admin/customers/${idC1}/addresses/${idA2}`, ck);
    t("addr-delete-default-200", delDef.status === 200 && delDef.body?.data?.deleted === true, `${delDef.status}`);
    const afterDel = await get(`/api/admin/customers/${idC1}/addresses`, ck);
    t("addr-zero-defaults-allowed", afterDel.status === 200
      && (afterDel.body?.data ?? []).filter((a) => a.isDefault === true).length === 0,
      `${afterDel.status}`);
    const reDef = await patch(`/api/admin/customers/${idC1}/addresses/${idA1}`, { isDefault: true }, ck);
    const afterReDef = await get(`/api/admin/customers/${idC1}/addresses`, ck);
    t("addr-new-default-after-delete", reDef.status === 200
      && (afterReDef.body?.data ?? []).filter((a) => a.isDefault === true).length === 1,
      `${reDef.status}`);
    // Concurrent default switch on two non-default addresses: statuses may be
    // 200/200 (serialized switches) or 200/409 (UQ loser) — both legal. The
    // invariant is exactly one default, and it is one of the two contenders.
    const a3 = await post(`/api/admin/customers/${idC1}/addresses`, { city: "Taha", phone: P_D1 }, ck);
    const a4 = await post(`/api/admin/customers/${idC1}/addresses`, { city: "Mallawi", phone: P_D1 }, ck);
    const idA3 = a3.body?.data?.id;
    const idA4 = a4.body?.data?.id;
    const [dsw1, dsw2] = await Promise.all([
      patch(`/api/admin/customers/${idC1}/addresses/${idA3}`, { isDefault: true }, ck),
      patch(`/api/admin/customers/${idC1}/addresses/${idA4}`, { isDefault: true }, ck),
    ]);
    const dswStatuses = [dsw1.status, dsw2.status].sort().join(",");
    t("addr-race-default-legal", dswStatuses === "200,200" || dswStatuses === "200,409", dswStatuses);
    const defRows = await q(`SELECT id::text AS id FROM customer_addresses WHERE customer_id = $1 AND is_default`, [idC1]);
    t("addr-race-default-single", defRows.length === 1 && (defRows[0].id === idA3 || defRows[0].id === idA4),
      `winner=${defRows[0]?.id}`);

    // ================= GUEST -> CUSTOMER UPGRADE =================
    const gU = await mkGuest([[P330, "1"]]);
    const mg = await post(`/api/store/cart/merge`, { customerId: idC1 }, null, { "x-guest-token": gU.tok });
    t("upgrade-merge-reassigned", mg.status === 200 && mg.body?.data?.merge?.mode === "reassigned", `${mg.status}/${mg.body?.data?.merge?.mode}`);
    const staleTok = await get(`/api/store/cart`, null, { "x-guest-token": gU.tok });
    t("upgrade-token-retired-404", staleTok.status === 404, String(staleTok.status));
    // Checkout through the CUSTOMER cart (no guest token): proves the merged cart is the ACTIVE customer cart.
    const resBeforeU = await reservedOf(P330);
    const oU = await checkout(null, idC1, idA1, key("upgrade"), {}, false);
    t("upgrade-checkout-201", oU.status === 201 && oU.body?.data?.order?.status === "CONFIRMED", `${oU.status}`);
    const oUItems = oU.body?.data?.order?.items ?? [];
    t("upgrade-order-line", oUItems.length === 1 && oUItems[0].productVariantId === P330
      && num(oUItems[0].requestedQuantity) === 1, JSON.stringify(oUItems.map((i) => i.requestedQuantity)));
    t("upgrade-reserved", num(await reservedOf(P330)) - num(resBeforeU) === 1);
    t("upgrade-single-customer", Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone = $1`, [CANON(P_D1)]))[0].n) === 1);

    // ================= FULL JOURNEY =================
    // identify -> addresses -> guest cart -> merge -> piece+weight -> promo ->
    // coupon -> estimate -> reprice -> checkout. Expected money:
    // P330 15.00 x2 = 30.00; ROMI 320.00 x0.125 = 40.00; gross 70.00;
    // 10% LINE on P330 = 3.00; coupon 20.00; discountTotal 23.00;
    // delivery 20.00; total 67.00.
    const cJ = await post(`/api/store/customers/identify`, { phone: P_D2, firstName: "Journey" });
    t("journey-identify", cJ.status === 200 && cJ.body?.data?.id === idC2, `${cJ.status}`);
    const aJ = await post(`/api/admin/customers/${idC2}/addresses`,
      { label: "home", city: "Matai", area: "Center", street: "Nile", buildingNumber: "3", landmark: "school", phone: P_D2, isDefault: true }, ck);
    const idAJ = aJ.body?.data?.id;
    t("journey-address", aJ.status === 201 && !!idAJ, String(aJ.status));
    const gJ = await mkGuest([[P330, "2"], [ROMI_V, "0.125"]]);
    const mgJ = await post(`/api/store/cart/merge`, { customerId: idC2 }, null, { "x-guest-token": gJ.tok });
    t("journey-merge", mgJ.status === 200, `${mgJ.status}/${mgJ.body?.data?.merge?.mode}`);
    // Promotions: 10% LINE on P330 + 20.00 ORDER parent carrying the coupon.
    const idPct = await mkPromo(
      { name: `BAD pct ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 }, ck);
    const idPar = await mkPromo(
      { name: `BAD par ${stamp}`, type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "20.00", priority: 100 },
      null, ck);
    await activate(idPct, ck);
    await activate(idPar, ck);
    const cpJ = await post(`/api/admin/coupons`, { promotionId: idPar, code: `BAD${stamp}`.toUpperCase().slice(0, 10) }, ck);
    const idCpJ = cpJ.body?.data?.id;
    const codeJ = cpJ.body?.data?.code;
    couponIds.add(idCpJ);
    t("journey-promo-coupon-ready", !!idPct && !!idPar && !!idCpJ && !!codeJ, `${codeJ}`);
    const estJ = await post(`/api/store/orders/estimate`, {
      customerId: idC2, lines: [{ productVariantId: P330, quantity: "2" }, { productVariantId: ROMI_V, quantity: "0.125" }], couponCode: codeJ,
    });
    const ej = estJ.body?.data ?? {};
    t("journey-estimate-match", estJ.status === 200 && num(ej.subtotal) === 70 && num(ej.discountTotal) === 23
      && num(ej.total) === 67, `${estJ.status}/${ej.subtotal}/${ej.discountTotal}/${ej.total}`);
    const repJ = await post(`/api/store/cart/reprice`, { customerId: idC2 });
    t("journey-reprice-200", repJ.status === 200, String(repJ.status));
    const resJ330 = await reservedOf(P330);
    const resJRomi = await reservedOf(ROMI_V);
    const oJ = await checkout(null, idC2, idAJ, key("journey"), { couponCode: codeJ }, false);
    const OJ = oJ.body?.data?.order;
    t("journey-201", oJ.status === 201 && OJ?.status === "CONFIRMED", `${oJ.status}`);
    t("journey-totals", OJ != null && num(OJ.subtotalEstimated) === 70 && num(OJ.discountTotal) === 23
      && num(OJ.deliveryFee) === 20 && num(OJ.totalEstimated) === 67,
      `${OJ?.subtotalEstimated}/${OJ?.discountTotal}/${OJ?.deliveryFee}/${OJ?.totalEstimated}`);
    const jItems = OJ?.items ?? [];
    t("journey-items-exact",
      jItems.length === 2
      && jItems.some((i) => i.productVariantId === P330 && num(i.unitPrice) === 15 && num(i.requestedQuantity) === 2
        && num(i.estimatedTotal) === 30 && i.unit === "PIECE" && i.productCode === "6221001000331" && i.codeType === "BARCODE")
      && jItems.some((i) => i.productVariantId === ROMI_V && num(i.unitPrice) === 320 && num(i.requestedQuantity) === 0.125
        && num(i.estimatedTotal) === 40 && i.unit === "KG" && i.productCode === "2010106" && i.codeType === "INTERNAL_CODE"),
      `${oJ.status}`);
    t("journey-weight-0125-40", jItems.some((i) => i.productVariantId === ROMI_V && num(i.estimatedTotal) === 40));
    // identify returns the EXISTING customer (name frozen at first identify):
    // BadTwo, not Journey.
    t("journey-customer-snapshot", OJ?.customerName === "BadTwo" && OJ?.customerPhone === CANON(P_D2),
      `${OJ?.customerName}/${OJ?.customerPhone}`);
    t("journey-address-snapshot", OJ?.delivery?.city === "Matai" && OJ?.delivery?.street === "Nile"
      && OJ?.delivery?.building === "3" && OJ?.delivery?.phone === CANON(P_D2),
      JSON.stringify(OJ?.delivery));
    t("journey-history", Array.isArray(OJ?.history) && OJ.history.length === 2
      && OJ.history[0].oldStatus === null && OJ.history[0].newStatus === "NEW"
      && OJ.history[1].oldStatus === "NEW" && OJ.history[1].newStatus === "CONFIRMED");
    t("journey-reserved", num(await reservedOf(P330)) - num(resJ330) === 2
      && num(await reservedOf(ROMI_V)) - num(resJRomi) === 0.125,
      `${await reservedOf(P330)}/${await reservedOf(ROMI_V)}`);
    t("journey-coupon-used", Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpJ]))[0].used_count) === 1);
    t("journey-promo-rows", Number((await q(`SELECT count(*)::int AS n FROM order_discounts WHERE order_id = $1::uuid`, [OJ?.id]))[0].n) >= 2);
    t("journey-cart-checked-out", (await q(`SELECT status FROM carts WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [idC2]))[0]?.status === "CHECKED_OUT");

    // ================= SNAPSHOT IMMUNITY =================
    // Mutate catalog + address AFTER checkout: the placed order must be frozen.
    const prodRen = await patch(`/api/admin/catalog/products/${PEPSI_PROD}`, { name: "Pepsi MUTATED" }, ck);
    const addrMut = await patch(`/api/admin/customers/${idC2}/addresses/${idAJ}`,
      { city: "MutatedCity", street: "MutatedStreet", phone: P_D1 }, ck);
    t("snap-mutations-applied", prodRen.status === 200 && addrMut.status === 200, `${prodRen.status}/${addrMut.status}`);
    const oJAgain = await get(`/api/store/orders/${OJ.id}?customerId=${idC2}`);
    const OJ2 = oJAgain.body?.data?.order;
    const jP330 = (OJ2?.items ?? []).find((i) => i.productVariantId === P330);
    t("snap-product-immune", oJAgain.status === 200 && jP330?.productName === "Pepsi"
      && num(jP330?.unitPrice) === 15 && num(OJ2?.subtotalEstimated) === 70,
      `${jP330?.productName}/${jP330?.unitPrice}`);
    t("snap-address-immune", OJ2?.delivery?.city === "Matai" && OJ2?.delivery?.street === "Nile"
      && OJ2?.delivery?.phone === CANON(P_D2), JSON.stringify(OJ2?.delivery));
    const prodBack = await patch(`/api/admin/catalog/products/${PEPSI_PROD}`, { name: "Pepsi" }, ck);
    const addrBack = await patch(`/api/admin/customers/${idC2}/addresses/${idAJ}`,
      { city: "Matai", street: "Nile", phone: P_D2 }, ck);
    t("snap-reverted", prodBack.status === 200 && addrBack.status === 200, `${prodBack.status}/${addrBack.status}`);
    // Delete the address the order used: the order must keep its full snapshot.
    const addrDel = await del(`/api/admin/customers/${idC2}/addresses/${idAJ}`, ck);
    t("addr-delete-post-order-200", addrDel.status === 200, String(addrDel.status));
    const oJAfterDel = await get(`/api/store/orders/${OJ.id}?customerId=${idC2}`);
    t("order-survives-address-delete", oJAfterDel.status === 200
      && oJAfterDel.body?.data?.order?.delivery?.city === "Matai", `${oJAfterDel.status}`);

    // ================= ADDRESS RACE DURING CHECKOUT =================
    // Fresh address per DELETE round (PATCH rounds reuse one address).
    const aR = await post(`/api/admin/customers/${idC1}/addresses`,
      { city: "RaceCity", street: "RaceStreet", landmark: "RaceMark", phone: P_D1 }, ck);
    const idAR = aR.body?.data?.id;
    for (let i = 0; i < 3; i++) {
      const pre = await get(`/api/admin/customers/${idC1}/addresses/${idAR}`, ck);
      const preT = [pre.body?.data?.city, pre.body?.data?.street, pre.body?.data?.landmark];
      const postT = [`PatchCity${i}`, `PatchStreet${i}`, `PatchMark${i}`];
      const gR = await mkGuest([[P330, "1"]]);
      const kR = key(`racep${i}`);
      const [pRes, oRes] = await Promise.all([
        patch(`/api/admin/customers/${idC1}/addresses/${idAR}`,
          { city: postT[0], street: postT[1], landmark: postT[2] }, ck),
        checkout(gR.tok, idC1, idAR, kR),
      ]);
      if (pRes.status !== 200) {
        t(`addr-race-patch-consistent-${i}`, false, `patch=${pRes.status}`);
        continue;
      }
      if (oRes.status === 201) {
        const snap = oRes.body?.data?.order?.delivery ?? {};
        const got = [snap.city, snap.street, snap.landmark];
        const isPre = JSON.stringify(got) === JSON.stringify(preT);
        const isPost = JSON.stringify(got) === JSON.stringify(postT);
        t(`addr-race-patch-consistent-${i}`, isPre || isPost, `got=${JSON.stringify(got)}`);
      } else if (oRes.status === 404) {
        const noRow = await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1`, [kR]);
        t(`addr-race-patch-consistent-${i}`, noRow[0].n === 0, `404 with row=${noRow[0].n}`);
      } else {
        t(`addr-race-patch-consistent-${i}`, false, `unexpected=${oRes.status}`);
      }
    }
    for (let i = 0; i < 3; i++) {
      const aRd = await post(`/api/admin/customers/${idC1}/addresses`,
        { city: `DelCity${i}`, phone: P_D1 }, ck);
      const idARd = aRd.body?.data?.id;
      const gRd = await mkGuest([[P330, "1"]]);
      const kRd = key(`raced${i}`);
      const resBefore = await reservedOf(P330);
      const [dRes, oRes] = await Promise.all([
        del(`/api/admin/customers/${idC1}/addresses/${idARd}`, ck),
        checkout(gRd.tok, idC1, idARd, kRd),
      ]);
      if (oRes.status === 201) {
        const snap = oRes.body?.data?.order?.delivery ?? {};
        t(`addr-race-delete-deterministic-${i}`, snap.city === `DelCity${i}` && snap.phone === CANON(P_D1),
          `201 city=${snap.city}`);
      } else if (oRes.status === 404) {
        const noRow = await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1`, [kRd]);
        const cartStill = await get(`/api/store/cart`, null, { "x-guest-token": gRd.tok });
        t(`addr-race-delete-deterministic-${i}`, dRes.status === 200 && noRow[0].n === 0
          && (await reservedOf(P330)) === resBefore && cartStill.status === 200,
          `404 ok (del=${dRes.status} rows=${noRow[0].n})`);
      } else {
        t(`addr-race-delete-deterministic-${i}`, false, `unexpected=${oRes.status}`);
      }
    }

    // ================= FAILED KEY REUSE =================
    // Force a 409 with key K (price drift), fix, reuse K -> 201, replay -> same order.
    const gFk = await mkGuest([[P330, "1"]]);
    await patch(`/api/admin/catalog/variants/${P330}/price`, { price: "17.00", reason: "bad drift test" }, ck);
    const kF = key("failreuse");
    const oFk = await checkout(gFk.tok, idC1, idA1, kF);
    t("key-fail-409", oFk.status === 409, String(oFk.status));
    await patch(`/api/admin/catalog/variants/${P330}/price`, { price: "15.00", reason: "bad revert" }, ck);
    const oFk2 = await checkout(gFk.tok, idC1, idA1, kF);
    t("key-fail-then-reuse-201", oFk2.status === 201, String(oFk2.status));
    const oFk3 = await checkout(gFk.tok, idC1, idA1, kF);
    t("key-replay-same", oFk3.status === 200 && oFk3.body?.data?.order?.id === oFk2.body?.data?.order?.id
      && oFk3.body?.meta?.replay === true, `${oFk3.status}`);

    // ================= IDENTITY RACE AT CHECKOUT =================
    // Convergent identity must be immediately usable: 8 parallel identifies,
    // then checkout with the single id.
    const idRace = await Promise.all(Array.from({ length: 8 }, () =>
      post(`/api/store/customers/identify`, { phone: P_D4, firstName: "RaceCk" })));
    const idRaceIds = idRace.map((r) => r.body?.data?.id);
    t("id-race-checkout-one-id", idRaceIds[0] !== undefined && idRaceIds.every((id) => id === idRaceIds[0]));
    const idC4 = idRaceIds[0];
    const aC4 = await post(`/api/admin/customers/${idC4}/addresses`, { city: "Matai", phone: P_D4 }, ck);
    const gC4 = await mkGuest([[P330, "1"]]);
    const oC4 = await checkout(gC4.tok, idC4, aC4.body?.data?.id, key("idrace"));
    t("id-race-checkout-match", oC4.status === 201
      && (await q(`SELECT customer_id::text AS c FROM orders WHERE id = $1::uuid`, [oC4.body?.data?.order?.id]))[0]?.c === idC4,
      `${oC4.status}`);

    // ================= FROZEN IDENTITY BINDING (documented, not a bug) ======
    // No customer auth exists in frozen scope: a guest cart checks out against
    // whichever (customerId, addressId) pair it supplies, as long as the
    // address belongs to that customer. This asserts the defined behavior.
    const gFb = await mkGuest([[P330, "1"]]);
    const oFb = await checkout(gFb.tok, idC1, idA1, key("frozenbind"));
    t("frozen-binding-201", oFb.status === 201, String(oFb.status));
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1,$2,$3,$4)`,
        [CANON(P_D1), CANON(P_D2), CANON(P_D3), CANON(P_D4)],
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
      for (const ph of [P_D1, P_D2, P_D3, P_D4].map(CANON)) {
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
      for (const ph of [P_D1, P_D2, P_D3, P_D4].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [STORE_EMAIL]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}


main().catch((e) => {
  console.error(`BAD_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
