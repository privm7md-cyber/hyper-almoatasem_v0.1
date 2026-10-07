// BA-C shopping verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-bac-shopping.mjs --db <name> --port <port>
// Covers the BA-C shopping contract: cart lifecycle (create/get/add/update/
// delete/reprice/ownership/expiry), PIECE/WEIGHT rules, server price
// authority + tamper rejection, merge (dup/dead/expired/conflict/ownership/
// concurrency), pricing pipeline (exact integer money), promotions (4 types,
// 4 scopes, priority, specificity, stacking, caps, minimums, windows),
// coupons (validate/apply/limits/concurrency/rollback), cart+promo+coupon
// integration flows, checkout boundary (drift 409). Prints JSON, no secrets.
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
  console.log(JSON.stringify({ suite: "bac-shopping", db: dbName, total: results.length, failures: failures.length, failed: failures, passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P330 = "01800000-0000-7000-8000-000000000201";
const SEED_PRODUCT = "01800000-0000-7000-8000-000000000200";
const P1L = "01800000-0000-7000-8000-000000000202";
const ROMI_V = "01800000-0000-7000-8000-000000000101";
const P_C1 = "01093000011";
const P_C2 = "01093000012";
const CANON = (p) => "2010" + p.slice(3);

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
  const put = (path, data, cookie = null, headers = {}) => jcall("PUT", path, data,
    { ...(cookie ? { cookie } : {}), ...headers });
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
  const key = (p) => `bacc-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const productIds = new Set();
  const variantIds = new Set();
  const catIds = new Set();
  const brandIds = new Set();
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
  const checkout = async (tok, sessTok, addrId, k, extra = {}) => {
    if (tok && sessTok) {
      await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": tok, ...H(sessTok) });
    }
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sessTok ? H(sessTok) : {}) },
      body: JSON.stringify({ addressId: addrId, idempotencyKey: k, ...extra }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const H = (tok) => ({ "x-customer-token": tok });
  const CPW = "Cust-Test-Pass-0001!";
  const sess = async (phone, firstName) => {
    // PHASE 2.5: register (fresh → 201 + session) or login (existing → 200).
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: CPW });
    if (reg.status === 201) {
      return { id: reg.body?.data?.customer?.id ?? null, tok: reg.body?.data?.customerToken ?? null };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: CPW });
    return { id: r.body?.data?.customer?.id ?? null, tok: r.body?.data?.customerToken ?? null };
  };
  const mkPromo = async (promo, target, rules, ck) => {
    const p = await post(`/api/admin/promotions`, promo, ck);
    const id = p.body.data.id;
    promoIds.add(id);
    if (target) await post(`/api/admin/promotions/${id}/targets`, target, ck);
    if (rules) await put(`/api/admin/promotions/${id}/rules`, rules, ck);
    return id;
  };
  const activate = async (id, ck) => patch(`/api/admin/promotions/${id}`, { status: "ACTIVE" }, ck);

  try {
    // Fail-closed server identity guard: the suite's own connection is already
    // allowlisted to scratch, but the API server under test is a separate
    // process with its own DATABASE_URL. If it was started without the scratch
    // override it points at hyper_almoatasem (production) and every call here
    // would write there. The seeded Pepsi product exists ONLY on scratch, so a
    // successful public catalog read proves which DB the server is bound to.
    const srvIdent = await get(`/api/store/catalog/products?limit=100`);
    const srvHasFixture = srvIdent.status === 200 && JSON.stringify(srvIdent.body).includes(SEED_PRODUCT);
    console.error(`[env] server-identity probe: catalog=${srvIdent.status} scratchFixture=${srvHasFixture}`);
    if (!srvHasFixture) {
      console.error(`REFUSED_WRONG_SERVER_DB: the API server on ${baseUrl} does not expose the scratch fixture ${SEED_PRODUCT} (status=${srvIdent.status}). Restart it with DATABASE_URL pointing at ${dbName}.`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("logins-ok", store.status === 201 && owner.status === 201, `${store.status}/${owner.status}`);
    if (store.status !== 201 || owner.status !== 201 || !store.cookie || !owner.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status} owner=${owner.status} (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = store.cookie;
    // Second, stronger identity check (runs after login because it needs the
    // admin cookie): prove the server and THIS connection address the same
    // database by round-tripping one row through both. Catches the case where
    // both databases happen to carry the seeded fixture.
    const envProbeName = `BAC envprobe ${stamp}`;
    const envProbe = await post(`/api/admin/promotions`, { name: envProbeName, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00" }, ck);
    const envProbeId = envProbe.body.data?.id ?? null;
    const envSeenByApi = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE id = $1::uuid`, [envProbeId]))[0].n);
    if (envProbeId) {
      await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1::uuid`, [envProbeId]).catch(() => {});
      await db.query(`DELETE FROM promotion_rules WHERE promotion_id = $1::uuid`, [envProbeId]).catch(() => {});
      await db.query(`DELETE FROM promotions WHERE id = $1::uuid`, [envProbeId]).catch(() => {});
    }
    t("env-server-db-matches-suite-db", envProbe.status === 201 && envSeenByApi === 1,
      `create=${envProbe.status} visibleToSuiteConnection=${envSeenByApi}`);
    if (envProbe.status !== 201 || envSeenByApi !== 1) {
      console.error(`REFUSED_WRONG_SERVER_DB: the API server wrote a row this connection cannot see (create=${envProbe.status}, seen=${envSeenByApi}). It is bound to a different database than ${dbName}.`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    // Environment guard: stray state (e.g. from a crashed run) silently
    // stacks promos into every checkout, drifts shared inventory, or leaves
    // debug catalog rows. Fail fast instead of asserting against pollution.
    const strayPromos = Number((await q(`SELECT count(*)::int AS n FROM promotions WHERE status = 'ACTIVE'`))[0].n);
    const strayCust = Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone IN ($1, $2)`, [CANON(P_C1), CANON(P_C2)]))[0].n);
    const strayDbg = Number((await q(`
      SELECT ((SELECT count(*) FROM products WHERE name LIKE 'Dbg%')
            + (SELECT count(*) FROM categories WHERE name LIKE 'Dbg%')
            + (SELECT count(*) FROM brands WHERE name LIKE 'Dbg%')
            + (SELECT count(*) FROM product_variants WHERE name LIKE 'Dbg%'))::int AS n`))[0].n);
    const strayInv = Number((await q(
      `SELECT count(*)::int AS n FROM inventory WHERE product_variant_id = $1::uuid AND (quantity <> 500.000 OR reserved_quantity <> 0.000)`,
      [P330]))[0].n);
    t("env-clean", strayPromos === 0 && strayCust === 0 && strayDbg === 0 && strayInv === 0,
      `activePromos=${strayPromos} leftoverCust=${strayCust} debugCatalog=${strayDbg} invDrift=${strayInv}`);
    if (strayPromos !== 0 || strayCust !== 0 || strayDbg !== 0 || strayInv !== 0) {
      console.error(`REFUSED_DIRTY_ENV: activePromos=${strayPromos} leftoverCust=${strayCust} debugCatalog=${strayDbg} invDrift=${strayInv} (clean scratch and rerun)`);
      await db.end().catch(() => {});
      process.exit(1);
    }

    // ================= CART LIFECYCLE =================
    // Session customer minted early (PHASE 2 identity for ownership tests below).
    const ssM = await sess(P_C1, "BacM");
    const idCuM = ssM.id;
    const tCuM = ssM.tok;
    t("session-ready", !!idCuM && !!tCuM, `${!!idCuM}/${!!tCuM}`);
    const g0 = await post(`/api/store/cart`, {});
    t("cart-create-201", g0.status === 201 && /^[0-9a-f]{64}$/.test(g0.body.data?.guestToken || ""), String(g0.status));
    cartIds.add(g0.body.data.cart.id);
    const tok0 = g0.body.data.guestToken;
    const gGet = await get(`/api/store/cart`, null, { "x-guest-token": tok0 });
    t("cart-get-200", gGet.status === 200 && gGet.body.data?.cart?.id === g0.body.data.cart.id, String(gGet.status));
    const a1 = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "2" }, null, { "x-guest-token": tok0 });
    t("cart-add-piece-200", a1.status === 200 && a1.body.data?.cart?.lines?.length === 1, String(a1.status));
    const aW = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.125" }, null, { "x-guest-token": tok0 });
    t("cart-add-weight-200", aW.status === 200, String(aW.status));
    const pieceFrac = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1.5" }, null, { "x-guest-token": tok0 });
    t("cart-piece-fraction-422", pieceFrac.status === 422, String(pieceFrac.status));
    const stepBad = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.100" }, null, { "x-guest-token": tok0 });
    t("cart-step-422", stepBad.status === 422, String(stepBad.status));
    // Full sale-step matrix on a 125 g KG product (0.125 increments).
    const gw = await post(`/api/store/cart`, {});
    cartIds.add(gw.body.data.cart.id);
    const tokW = gw.body.data.guestToken;
    const stepMatrix = [];
    for (const q of ["0.250", "0.500", "1.000", "1.250"]) {
      const r = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: q }, null, { "x-guest-token": tokW });
      stepMatrix.push(`${q}:${r.status}`);
    }
    t("weight-step-matrix-ok", stepMatrix.every((s) => s.endsWith(":200")), stepMatrix.join(" "));
    const stepOff = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.130" }, null, { "x-guest-token": tokW });
    t("weight-step-off-422", stepOff.status === 422, String(stepOff.status));
    const wGet = await get(`/api/store/cart`, null, { "x-guest-token": tokW });
    const wLine = (wGet.body.data?.cart?.lines || []).find((l) => l.productVariantId === ROMI_V);
    // 0.250 + 0.500 + 1.000 + 1.250 = 3.000 kg @ 320.00 = 960.00 exactly.
    t("weight-decimal-exact", wLine != null && Number(wLine.lineTotal) === 960,
      `${wLine?.quantity}/${wLine?.unitPrice}/${wLine?.lineTotal}`);
    const tamper = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1", price: "0.01" }, null, { "x-guest-token": tok0 });
    t("cart-price-tamper-400", tamper.status === 400, String(tamper.status));
    const setQ = await patch(`/api/store/cart/items/${P330}`, { quantity: "3" }, null, { "x-guest-token": tok0 });
    t("cart-setqty-200", setQ.status === 200, String(setQ.status));
    const setPrice = await patch(`/api/store/cart/items/${P330}`, { quantity: "3", unitPrice: "0.01" }, null, { "x-guest-token": tok0 });
    t("cart-patch-tamper-400", setPrice.status === 400, String(setPrice.status));
    const rmLine = await del(`/api/store/cart/items/${ROMI_V}`, null, { "x-guest-token": tok0 });
    t("cart-remove-200", rmLine.status === 200, String(rmLine.status));
    const rmMiss = await del(`/api/store/cart/items/${ROMI_V}`, null, { "x-guest-token": tok0 });
    t("cart-remove-miss-404", rmMiss.status === 404, String(rmMiss.status));

    // Ownership isolation.
    const gB = await post(`/api/store/cart`, {});
    cartIds.add(gB.body.data.cart.id);
    const tokB = gB.body.data.guestToken;
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "9" }, null, { "x-guest-token": tokB });
    const cross = await get(`/api/store/cart`, null, { "x-guest-token": tok0 });
    const crossLines = cross.body.data?.cart?.lines || [];
    t("cart-cross-isolation", cross.status === 200 && crossLines.length === 1
      && crossLines[0].productVariantId === P330 && Number(crossLines[0].quantity) === 3,
      JSON.stringify(crossLines.map((l) => l.quantity)));
    const bothSides = await post(`/api/store/cart/items`,
      { productVariantId: P330, quantity: "1" }, null, { "x-guest-token": tok0, ...H(tCuM) });
    t("cart-xor-400", bothSides.status === 400, String(bothSides.status));

    // Expiry.
    const gE = await post(`/api/store/cart`, {});
    const tokE = gE.body.data.guestToken;
    const idE = gE.body.data.cart.id;
    cartIds.add(idE);
    await db.query(`UPDATE carts SET expires_at = now() - interval '1 day' WHERE id = $1::uuid`, [idE]);
    const eGet = await get(`/api/store/cart`, null, { "x-guest-token": tokE });
    const eAdd = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1" }, null, { "x-guest-token": tokE });
    const eRep = await post(`/api/store/cart/reprice`, {}, null, { "x-guest-token": tokE });
    t("cart-expired-404", eGet.status === 404 && eAdd.status === 404 && eRep.status === 404,
      `${eGet.status}/${eAdd.status}/${eRep.status}`);

    // Reprice: price change → snapshot refresh; dead variant → dropped.
    const rpCat = await post(`/api/admin/catalog/categories`, { name: `BAC Repr ${stamp}`, slug: `bac-repr-${stamp}` }, ck);
    catIds.add(rpCat.body.data.id);
    const rpProd = await post(`/api/admin/catalog/products`, {
      name: `BAC ReprProd ${stamp}`, categoryId: rpCat.body.data.id, productType: "PIECE", unit: "PIECE",
    }, ck);
    productIds.add(rpProd.body.data.id);
    const rpVar = await post(`/api/admin/catalog/products/${rpProd.body.data.id}/variants`, { name: "V", price: "100.00" }, ck);
    const idRV = rpVar.body.data.id;
    variantIds.add(idRV);
    const gR = await mkGuest([[idRV, "1"]]);
    await patch(`/api/admin/catalog/variants/${idRV}/price`, { price: "110.00" }, ck);
    const rep1 = await post(`/api/store/cart/reprice`, {}, null, { "x-guest-token": gR.tok });
    t("reprice-refresh", rep1.status === 200 && rep1.body.data?.reprice?.repriced === 1
      && Number(rep1.body.data?.cart?.lines?.[0]?.unitPriceSnapshot) === 110, JSON.stringify(rep1.body.data?.reprice));
    const rep2 = await post(`/api/store/cart/reprice`, {}, null, { "x-guest-token": gR.tok });
    t("reprice-noop", rep2.status === 200 && rep2.body.data?.reprice?.repriced === 0, JSON.stringify(rep2.body.data?.reprice));
    await patch(`/api/admin/catalog/variants/${idRV}`, { isActive: false }, ck);
    const rep3 = await post(`/api/store/cart/reprice`, {}, null, { "x-guest-token": gR.tok });
    t("reprice-drop-dead", rep3.status === 200 && rep3.body.data?.reprice?.dropped?.length === 1
      && (rep3.body.data?.cart?.lines || []).length === 0, JSON.stringify(rep3.body.data?.reprice));
    const repTamper = await post(`/api/store/cart/reprice`, { quantity: "5" }, null, { "x-guest-token": gR.tok });
    t("reprice-strict-400", repTamper.status === 400, String(repTamper.status));

    // ================= MERGE =================
    const adM = await post(`/api/admin/customers/${idCuM}/addresses`, { city: "Matai", phone: P_C1 }, ck);
    const idAdM = adM.body.data.id;
    const gM1 = await mkGuest([[P330, "1"]]);
    const mg1 = await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": gM1.tok, ...H(tCuM) });
    t("merge-reassign", mg1.status === 200 && mg1.body.data?.merge?.mode === "reassigned", String(mg1.status));
    const gM2 = await mkGuest([[P330, "2"]]);
    const mg2 = await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": gM2.tok, ...H(tCuM) });
    const mg2Lines = mg2.body.data?.cart?.lines || [];
    t("merge-sum", mg2.status === 200 && mg2Lines.some((l) => l.productVariantId === P330 && Number(l.quantity) === 3),
      JSON.stringify(mg2Lines.map((l) => l.quantity)));
    const mgAgain = await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": gM2.tok, ...H(tCuM) });
    t("merge-consumed-409", mgAgain.status === 409, String(mgAgain.status));
    const mgDead = await post(`/api/store/cart/merge`, {}, null, { "x-guest-token": tokE, ...H(tCuM) });
    t("merge-expired-409", mgDead.status === 409, String(mgDead.status));
    const [mmA, mmB] = await Promise.all([
      (async () => {
        const g = await mkGuest([[P1L, "1"]]);
        return post(`/api/store/cart/merge`, {}, null, { "x-guest-token": g.tok, ...H(tCuM) });
      })(),
      (async () => {
        const g = await mkGuest([[P1L, "1"]]);
        return post(`/api/store/cart/merge`, {}, null, { "x-guest-token": g.tok, ...H(tCuM) });
      })(),
    ]);
    t("merge-concurrent-clean", mmA.status === 200 && mmB.status === 200, `${mmA.status}/${mmB.status}`);
    const custCart = await get(`/api/store/cart`, null, H(tCuM));
    const p1lQty = (custCart.body.data?.cart?.lines || []).filter((l) => l.productVariantId === P1L)
      .reduce((s, l) => s + Number(l.quantity), 0);
    t("merge-no-double", p1lQty === 2, String(p1lQty));

    // ================= PRICING (exact integer money) =================
    const gP = await mkGuest([[P330, "2"]]);
    const cartP = await get(`/api/store/cart`, null, { "x-guest-token": gP.tok });
    const linesP = cartP.body.data?.cart?.lines || [];
    t("price-line-math", linesP.length === 1 && linesP[0].lineTotal === "30.00", JSON.stringify(linesP.map((l) => l.lineTotal)));
    t("price-subtotal-math", cartP.body.data?.cart?.subtotal === "30.00", String(cartP.body.data?.cart?.subtotal));
    const gW = await mkGuest([[ROMI_V, "0.125"]]);
    const cartW = await get(`/api/store/cart`, null, { "x-guest-token": gW.tok });
    const linesW = cartW.body.data?.cart?.lines || [];
    // 320.00 EGP/kg × 0.125 kg = 40.00 exactly.
    t("price-weight-math", linesW.length === 1 && linesW[0].lineTotal === "40.00", JSON.stringify(linesW.map((l) => l.lineTotal)));

    // ================= PROMOTIONS (isolated engine proofs) =================
    const setStatus = async (id, st) => patch(`/api/admin/promotions/${id}`, { status: st }, ck);
    const disableAll = async () => {
      for (const id of promoIds) await setStatus(id, "DISABLED").catch(() => {});
    };
    const brandOfP330 = (await q(`SELECT p.brand_id::text AS b FROM product_variants v
      JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [P330]))[0]?.b ?? null;
    // PERCENTAGE LINE 10% on P330.
    const idPct = await mkPromo(
      { name: `BAC pct ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 }, null, ck);
    // FIXED_AMOUNT ORDER 20.00 (targetless).
    const idFix = await mkPromo(
      { name: `BAC fix ${stamp}`, type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "20.00", priority: 5 },
      null, null, ck);
    // BXGY buy 2 get 1 @100% on P1L.
    const idBxgy = await mkPromo(
      { name: `BAC bxgy ${stamp}`, type: "BUY_X_GET_Y", scope: "LINE", priority: 20 }, null, null, ck);
    await put(`/api/admin/promotions/${idBxgy}/buy-get`,
      { buyQuantity: "2", getQuantity: "1", discountPercent: "100.00" }, ck);
    await post(`/api/admin/promotions/${idBxgy}/targets`, { targetType: "VARIANT", targetId: P1L }, ck);
    // FIXED_PRICE LINE 12.00 on P330 (per-unit).
    const idFp = await mkPromo(
      { name: `BAC fp ${stamp}`, type: "FIXED_PRICE", scope: "LINE", fixedPrice: "12.00", priority: 30 },
      { targetType: "VARIANT", targetId: P330 }, null, ck);
    // Specificity pair: brand 5% vs variant 10% (same priority).
    const idBrandP = await mkPromo(
      { name: `BAC brand ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "5.00", priority: 10 },
      brandOfP330 ? { targetType: "BRAND", targetId: brandOfP330 } : { targetType: "VARIANT", targetId: P1L }, null, ck);
    // Stacking pair: two stackable 10% LINE on P330.
    const idSt1 = await mkPromo(
      { name: `BAC st1 ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10, isStackable: true },
      { targetType: "VARIANT", targetId: P330 }, null, ck);
    const idSt2 = await mkPromo(
      { name: `BAC st2 ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 9, isStackable: true },
      { targetType: "VARIANT", targetId: P330 }, null, ck);
    // Cap: 50% LINE capped at 5.00 on P330.
    const idCap = await mkPromo(
      { name: `BAC cap ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "50.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 }, { maximumDiscount: "5.00" }, ck);
    // Minimums: ORDER 10% min 1000 (skip), LINE 10% min qty 5 (skip).
    const idMinA = await mkPromo(
      { name: `BAC minA ${stamp}`, type: "PERCENTAGE", scope: "ORDER", discountPercent: "10.00", priority: 10 },
      null, { minimumAmount: "1000.00" }, ck);
    const idMinQ = await mkPromo(
      { name: `BAC minQ ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 }, { minimumQuantity: "5" }, ck);
    // Window: LINE 10% starting in the future (skip).
    const idWin = await mkPromo(
      { name: `BAC win ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10,
        startAt: new Date(Date.now() + 3600_000).toISOString() },
      { targetType: "VARIANT", targetId: P330 }, null, ck);
    const onlyOn = async (...ids) => {
      await disableAll();
      for (const id of ids) await setStatus(id, "ACTIVE");
      if (process.env.BAC_DEBUG) {
        const act = await q(`SELECT name, status FROM promotions WHERE name LIKE 'BAC %' ORDER BY 1`);
        console.log("ONLYON", ids.map((x) => x.slice(0, 4)).join(","), JSON.stringify(act.map((r) => `${r.name.split(" ")[1]}:${r.status}`)));
      }
    };
    const orderDisc = async (lines, k, extra = {}) => {
      // Isolate: empty the session cart first (merges otherwise accumulate).
      await del(`/api/store/cart/items`, null, H(tCuM));
      const g = await mkGuest(lines);
      return checkout(g.tok, tCuM, idAdM, k, extra);
    };
    // NOTE: order discountTotal serializes via Decimal.toString (trailing
    // zeros normalized: "3.00" -> "3") — asserts compare numerically.
    await onlyOn(idPct);
    const oPct = await orderDisc([[P330, "2"]], key("pct"));
    t("promo-pct-10", oPct.status === 201 && Number(oPct.body.data?.order?.discountTotal) === 3,
      `${oPct.status}/${oPct.body.data?.order?.discountTotal}`);
    await onlyOn(idFix);
    const oFix = await orderDisc([[P330, "2"]], key("fix"));
    t("promo-fix-20", oFix.status === 201 && Number(oFix.body.data?.order?.discountTotal) === 20,
      `${oFix.status}/${oFix.body.data?.order?.discountTotal}`);
    await onlyOn(idBxgy);
    const oBxgy = await orderDisc([[P1L, "2"]], key("bxgy"));
    t("promo-bxgy-free", oBxgy.status === 201 && Number(oBxgy.body.data?.order?.discountTotal) === 30,
      `${oBxgy.status}/${oBxgy.body.data?.order?.discountTotal}`);
    await onlyOn(idFp);
    const oFp = await orderDisc([[P330, "1"]], key("fp"));
    t("promo-fixedprice-3", oFp.status === 201 && Number(oFp.body.data?.order?.discountTotal) === 3,
      `${oFp.status}/${oFp.body.data?.order?.discountTotal}`);
    await onlyOn(idPct, idBrandP);
    const oSpec = await orderDisc([[P330, "2"]], key("spec"));
    t("promo-specificity-variant-wins", oSpec.status === 201 && Number(oSpec.body.data?.order?.discountTotal) === 3,
      `${oSpec.status}/${oSpec.body.data?.order?.discountTotal}`);
    await onlyOn(idSt1, idSt2);
    const oStack = await orderDisc([[P330, "2"]], key("stack"));
    t("promo-stack-compound", oStack.status === 201 && Number(oStack.body.data?.order?.discountTotal) === 5.7,
      `${oStack.status}/${oStack.body.data?.order?.discountTotal}`);
    await onlyOn(idCap);
    const oCap = await orderDisc([[P330, "2"]], key("cap"));
    t("promo-cap-5", oCap.status === 201 && Number(oCap.body.data?.order?.discountTotal) === 5,
      `${oCap.status}/${oCap.body.data?.order?.discountTotal}`);
    await onlyOn(idMinA);
    const oMinA = await orderDisc([[P330, "2"]], key("mina"));
    t("promo-minamount-skip", oMinA.status === 201 && Number(oMinA.body.data?.order?.discountTotal) === 0,
      `${oMinA.status}/${oMinA.body.data?.order?.discountTotal}`);
    await onlyOn(idMinQ);
    const oMinQ = await orderDisc([[P330, "2"]], key("minq"));
    t("promo-minqty-skip", oMinQ.status === 201 && Number(oMinQ.body.data?.order?.discountTotal) === 0,
      `${oMinQ.status}/${oMinQ.body.data?.order?.discountTotal}`);
    await onlyOn(idWin);
    const oWin = await orderDisc([[P330, "2"]], key("win"));
    t("promo-window-skip", oWin.status === 201 && Number(oWin.body.data?.order?.discountTotal) === 0,
      `${oWin.status}/${oWin.body.data?.order?.discountTotal}`);
    // Targeted ORDER minimum is measured on ELIGIBLE gross, not cart-wide
    // (frozen phase4 semantics). Below: P330-only eligible gross must decide.
    const idOrdMin = await mkPromo(
      { name: `BAC ordmin ${stamp}`, type: "PERCENTAGE", scope: "ORDER", discountPercent: "10.00", priority: 10 },
      { targetType: "VARIANT", targetId: P330 }, { minimumAmount: "20.00" }, ck);
    await onlyOn(idOrdMin);
    const oOrdOk = await orderDisc([[P330, "2"]], key("ordok"));
    t("promo-order-min-qualifies", oOrdOk.status === 201 && Number(oOrdOk.body.data?.order?.discountTotal) === 3,
      `${oOrdOk.status}/${oOrdOk.body.data?.order?.discountTotal}`);
    // Cart-wide gross 45.00 >= 20.00, but eligible (P330) gross is 15.00 < 20.00
    // -> must NOT qualify. Pre-fix this returned a 1.50 discount.
    const oOrdNo = await orderDisc([[P330, "1"], [P1L, "1"]], key("ordno"));
    t("promo-order-min-eligible-only", oOrdNo.status === 201 && Number(oOrdNo.body.data?.order?.discountTotal) === 0,
      `${oOrdNo.status}/${oOrdNo.body.data?.order?.discountTotal}`);
    // Window that contains now() must apply.
    const idWinIn = await mkPromo(
      { name: `BAC winin ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10,
        startAt: new Date(Date.now() - 3600_000).toISOString(), endAt: new Date(Date.now() + 3600_000).toISOString() },
      { targetType: "VARIANT", targetId: P330 }, null, ck);
    await onlyOn(idWinIn);
    const oWinIn = await orderDisc([[P330, "2"]], key("winin"));
    t("promo-window-inside", oWinIn.status === 201 && Number(oWinIn.body.data?.order?.discountTotal) === 3,
      `${oWinIn.status}/${oWinIn.body.data?.order?.discountTotal}`);
    // Window instants must be stored exactly. Guards the CC-1 timestamp trap:
    // a Prisma Date write on a non-UTC server session stores the wall clock
    // stamped as UTC (shifted by the server offset), so a future window would
    // be treated as already started. Asserted against the DB clock directly,
    // because the Prisma READ path shifts by the same amount and would hide it.
    const sentStart = new Date(Date.now() + 7200_000).toISOString();
    const rtPromo = await post(`/api/admin/promotions`, {
      name: `BAC rt ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", startAt: sentStart,
    }, ck);
    if (rtPromo.body.data?.id) promoIds.add(rtPromo.body.data.id);
    const rtDelta = Number((await q(
      `SELECT extract(epoch FROM (start_at - now()))::int AS d FROM promotions WHERE id = $1::uuid`,
      [rtPromo.body.data?.id]))[0]?.d ?? NaN);
    t("promo-window-stored-exact", rtPromo.status === 201 && Number.isFinite(rtDelta)
      && rtDelta > 5400 && rtDelta < 9000,
      `sentDelta=7200 storedDelta=${rtDelta} status=${rtPromo.status}`);
    await disableAll();

    // ================= COUPONS + INTEGRATION =================
    const idCpPar = await mkPromo(
      { name: `BAC cppar ${stamp}`, type: "FIXED_AMOUNT", scope: "ORDER", discountAmount: "20.00", priority: 100 }, null, null, ck);
    promoIds.add(idCpPar);
    await activate(idCpPar, ck);
    // Estimate preview (read-only): P330 x2 = 30.00 gross, 10% line promo.
    // NOTE: the estimate schema is strict and address-free (delivery fee is a
    // store setting; addressId is a checkout-only field) -> sending it is 400.
    // NOTE: a promotion that owns a coupon is gated out of auto-application
    // (checkout.ts `gated`), so idCpPar must get its coupon BEFORE the
    // no-coupon estimate or the 20.00 would apply as a plain ORDER promo.
    await onlyOn(idPct, idCpPar);
    const estA = await post(`/api/admin/coupons`, { promotionId: idCpPar, code: `BAC${stamp}`.toUpperCase().slice(0, 10) }, ck);
    const idCpA = estA.body.data.id;
    const codeA = estA.body.data.code;
    couponIds.add(idCpA);
    const est = await post(`/api/store/orders/estimate`, {
      lines: [{ productVariantId: P330, quantity: "2" }],
    }, null, H(tCuM));
    const ed = est.body.data ?? {};
    t("estimate-shape", est.status === 200 && Array.isArray(ed.lines) && ed.lines.length === 1
      && typeof ed.subtotal === "string" && typeof ed.discountTotal === "string"
      && typeof ed.total === "string" && ed.coupon === null
      && typeof ed.lines[0]?.gross === "string" && Array.isArray(ed.lines[0]?.discounts),
      `${est.status}/${JSON.stringify(est.body).slice(0, 140)}`);
    t("estimate-math", est.status === 200 && Number(ed.subtotal) === 30 && Number(ed.discountTotal) === 3
      && Number(ed.lines[0]?.net) === 27, `${ed.subtotal}/${ed.discountTotal}/${ed.lines[0]?.net}`);
    const estBad = await post(`/api/store/orders/estimate`, {
      addressId: idAdM,
      lines: [{ productVariantId: P330, quantity: "2" }],
    }, null, H(tCuM));
    t("estimate-strict-400", estBad.status === 400, String(estBad.status));
    const estMiss = await post(`/api/store/orders/estimate`, {
      lines: [{ productVariantId: P330, quantity: "2" }], couponCode: "NEVER-EXISTS-00",
    }, null, H(tCuM));
    t("estimate-unknown-coupon-404", estMiss.status === 404, String(estMiss.status));
    // Full journey: cart (P330 x2 = 30.00) + 10% line auto + 20.00 coupon.
    // (Clear the merge-test cart first so journey lines are exact.)
    await del(`/api/store/cart/items`, null, H(tCuM));
    const gJ = await mkGuest([[P330, "2"]]);
    const oJ = await checkout(gJ.tok, tCuM, idAdM, key("j"), { couponCode: codeA });
    t("journey-201", oJ.status === 201, `${oJ.status}/${JSON.stringify(oJ.body.error ?? {}).slice(0, 120)}`);
    const oJd = oJ.body.data?.order;
    // Line: 30.00 - 10% (3.00) = 27.00; coupon promo -20.00 -> 23.00 total.
    t("journey-math", oJd != null && Number(oJd.discountTotal) === 23,
      `${JSON.stringify({ d: oJd?.discountTotal, t: oJd?.totalEstimated })}`);
    const est2 = await post(`/api/store/orders/estimate`, {
      lines: [{ productVariantId: P330, quantity: "2" }], couponCode: codeA,
    }, null, H(tCuM));
    t("estimate-matches", est2.status === 200 && Number(est2.body.data?.discountTotal) === 23,
      `${est2.status}/${JSON.stringify(est2.body).slice(0, 140)}`);
    // Coupon codes are case-insensitive at apply time.
    const gLc = await mkGuest([[P330, "2"]]);
    const oLc = await checkout(gLc.tok, tCuM, idAdM, key("lcase"), { couponCode: codeA.toLowerCase() });
    t("coupon-code-normalized", oLc.status === 201 && Number(oLc.body.data?.order?.discountTotal) === 23,
      `${oLc.status}/${oLc.body.data?.order?.discountTotal}`);
    // Expired coupon fails checkout.
    const cpExp = await post(`/api/admin/coupons`, {
      promotionId: idCpPar, code: `BACE${stamp}`.toUpperCase().slice(0, 10),
      endAt: new Date(Date.now() - 3600_000).toISOString(),
    }, ck);
    couponIds.add(cpExp.body.data.id);
    const gE2 = await mkGuest([[P330, "1"]]);
    const oExp = await checkout(gE2.tok, tCuM, idAdM, key("exp"), { couponCode: cpExp.body.data.code });
    t("coupon-expired-422", oExp.status === 422, String(oExp.status));
    // Per-customer limit 1: same customer twice.
    const cpLim = await post(`/api/admin/coupons`, {
      promotionId: idCpPar, code: `BACL${stamp}`.toUpperCase().slice(0, 10), perCustomerLimit: 1,
    }, ck);
    couponIds.add(cpLim.body.data.id);
    const gL1 = await mkGuest([[P330, "1"]]);
    const oL1 = await checkout(gL1.tok, tCuM, idAdM, key("lim1"), { couponCode: cpLim.body.data.code });
    const gL2 = await mkGuest([[P330, "1"]]);
    const oL2 = await checkout(gL2.tok, tCuM, idAdM, key("lim2"), { couponCode: cpLim.body.data.code });
    t("coupon-percust-limit", oL1.status === 201 && oL2.status === 422, `${oL1.status}/${oL2.status}`);
    // Global limit 1 across two customers: concurrent checkouts, exactly one wins.
    const cpG = await post(`/api/admin/coupons`, {
      promotionId: idCpPar, code: `BACG${stamp}`.toUpperCase().slice(0, 10), usageLimit: 1,
    }, ck);
    const idCpG = cpG.body.data.id;
    couponIds.add(idCpG);
    const ss2 = await sess(P_C2, "Bac2");
    const idCu2 = ss2.id;
    const tCu2 = ss2.tok;
    const ad2 = await post(`/api/admin/customers/${idCu2}/addresses`, { city: "Matai", phone: P_C2 }, ck);
    const [cG1, cG2] = await Promise.all([
      (async () => { const g = await mkGuest([[P330, "1"]]); return checkout(g.tok, tCuM, idAdM, key("cg1"), { couponCode: cpG.body.data.code }); })(),
      (async () => { const g = await mkGuest([[P330, "1"]]); return checkout(g.tok, tCu2, ad2.body.data.id, key("cg2"), { couponCode: cpG.body.data.code }); })(),
    ]);
    const winCount = [cG1.status, cG2.status].filter((s) => s === 201).length;
    const usageN = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpG]))[0].used_count);
    t("coupon-limit-race", winCount === 1 && usageN === 1, `${cG1.status}/${cG2.status}/used=${usageN}`);
    // Rollback: coupon + stock-short → 409, counters/usages untouched.
    await db.query(`UPDATE inventory SET quantity = 1.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const usedBefore = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpA]))[0].used_count);
    const gRb = await mkGuest([[P330, "2"]]);
    const oRb = await checkout(gRb.tok, tCuM, idAdM, key("rb"), { couponCode: codeA });
    const usedAfter = Number((await q(`SELECT used_count FROM coupons WHERE id = $1::uuid`, [idCpA]))[0].used_count);
    const usageRows = Number((await q(`SELECT count(*)::int AS n FROM coupon_usages WHERE coupon_id = $1::uuid AND order_id IN (SELECT id FROM orders WHERE idempotency_key = $2)`, [idCpA, oRb.body.data?.order?.id ?? key("rb")]))[0].n);
    t("coupon-rollback", oRb.status === 409 && usedAfter === usedBefore && usageRows === 0,
      `${oRb.status}/${usedBefore}->${usedAfter}/${usageRows}`);
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    // Drift boundary preserved: reprice then checkout succeeds.
    const gD = await mkGuest([[P330, "1"]]);
    await post(`/api/store/cart/reprice`, {}, null, { "x-guest-token": gD.tok });
    const oD = await checkout(gD.tok, tCuM, idAdM, key("drift"));
    t("checkout-after-reprice-201", oD.status === 201, String(oD.status));
    await disableAll();
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1, $2)`, [CANON(P_C1), CANON(P_C2)],
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
      for (const id of variantIds) {
        await db.query(`DELETE FROM inventory WHERE product_variant_id = $1`, [id]).catch(() => {});
      }
      for (const id of variantIds) {
        await db.query(`DELETE FROM product_price_history WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM product_variants WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of productIds) {
        await db.query(`DELETE FROM products WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of brandIds) {
        await db.query(`DELETE FROM brands WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of catIds) {
        await db.query(`DELETE FROM categories WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const phone of [CANON(P_C1), CANON(P_C2)]) {
        const cust = await db.query(`SELECT id FROM customers WHERE phone = $1`, [phone]).catch(() => ({ rows: [] }));
        for (const r of cust.rows) {
          await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
          for (const c of cc.rows) {
            await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
            await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
          }
        }
        await db.query(`DELETE FROM customers WHERE phone = $1`, [phone]).catch(() => {});
      }
      for (const email of [STORE_EMAIL, OWNER_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
      await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]).catch(() => {});
      await db.query(`UPDATE inventory SET quantity = 300.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P1L]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`BAC_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  done(1);
});
