// PRE-BA-11 audit-pairing retrofit suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-audit-pairing.mjs --db <name> --port <port>
// For every retrofitted BA-2..BA-8 admin surface: A (success commits
// mutation+audit), B (business failure commits neither), C (forced audit
// failure rolls back the business mutation — scratch-only BEFORE INSERT
// trigger installed/dropped inside this harness; no production hook).
// Plus concurrency: same-mutation race, mutation+read, mutation conflict,
// RBAC-mutation + sensitive-op race. Customer self-service paths stay
// unaudited (verified for cancel + decide). Prints JSON, never secrets.
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
  console.log(JSON.stringify({ suite: "audit-pairing", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
const P1L = "01800000-0000-7000-8000-000000000202";
const P_A1 = "01096000121";
const P_A2 = "01096000122";
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

  const stamp = Date.now().toString(36);
  const keySeq = { n: 0 };
  const key = (p) => `ba11a-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const userIds = new Set();
  const roleIds = new Set();
  const brandIds = new Set();
  const catIds = new Set();
  const productIds = new Set();
  const variantIds = new Set();
  const repIds = new Set();
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const auditCount = async (action, entityId = null) => Number(entityId === null
    ? (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1`, [action]))[0].n
    : (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2::uuid`, [action, entityId]))[0].n);
  const installAuditBomb = async () => {
    await db.query(`CREATE FUNCTION tmp_ba11a_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'TEST_INJECTED_AUDIT_FAILURE'; END $f$`);
    await db.query(`CREATE TRIGGER tmp_ba11a_audit_fail_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION tmp_ba11a_audit_fail()`);
  };
  const dropAuditBomb = async () => {
    await db.query(`DROP TRIGGER IF EXISTS tmp_ba11a_audit_fail_trg ON audit_logs`).catch(() => {});
    await db.query(`DROP FUNCTION IF EXISTS tmp_ba11a_audit_fail()`).catch(() => {});
  };
  const mkCart = async (lines) => {
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
    return tok;
  };
  const checkout = async (custId, addrId, lines, k) => {
    const tok = await mkCart(lines);
    const r = await fetch(`${baseUrl}/api/store/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guest-token": tok },
      body: JSON.stringify({ customerId: custId, addressId: addrId, idempotencyKey: k }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const orderItemsOf = async (orderId, custId) =>
    (await fetch(`${baseUrl}/api/store/orders/${orderId}?customerId=${custId}`).then((r) => r.json())).data.order.items;
  const invQty = async (v) => (await q(`SELECT quantity::text AS qq, reserved_quantity::text AS rr FROM inventory WHERE product_variant_id = $1`, [v]))[0];
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));
  const movIdsBefore = new Set((await q(`SELECT id::text AS id FROM inventory_movements`)).map((r) => r.id));
  const invSnap = {};
  for (const v of [P330, P1L]) invSnap[v] = await invQty(v);

  try {
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("logins-ok", store.status === 200 && owner.status === 200);
    if (store.status !== 200 || owner.status !== 200 || !store.cookie || !owner.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status} owner=${owner.status} (rate buckets may be exhausted — retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = store.cookie;
    const cko = owner.cookie;

    // ---------- catalog A/B ----------
    const bName = `BA11A Brand ${stamp}`;
    const bA = await post(`/api/admin/catalog/brands`, { name: bName }, ck);
    t("cat-brand-create-201", bA.status === 201 && isUuid(bA.body.data.id), String(bA.status));
    const idBrand = bA.body.data.id;
    brandIds.add(idBrand);
    t("cat-brand-audit", (await auditCount("brands.create", idBrand)) === 1);
    const bDupBefore = await auditCount("brands.create");
    const bB = await post(`/api/admin/catalog/brands`, { name: bName }, ck);
    t("cat-brand-dup-409", bB.status === 409, String(bB.status));
    t("cat-brand-noaudit", (await auditCount("brands.create")) === bDupBefore);
    const bPatch = await patch(`/api/admin/catalog/brands/${idBrand}`, { name: `${bName} R` }, ck);
    t("cat-brand-patch-200", bPatch.status === 200, String(bPatch.status));
    t("cat-brand-patch-audit", (await auditCount("brands.update", idBrand)) === 1);
    const cName = `BA11A Cat ${stamp}`;
    const cA = await post(`/api/admin/catalog/categories`, { name: cName }, ck);
    const idCat = cA.body.data.id;
    catIds.add(idCat);
    t("cat-cat-audit", cA.status === 201 && (await auditCount("categories.create", idCat)) === 1);
    const cDup = await post(`/api/admin/catalog/categories`, { name: cName }, ck);
    t("cat-cat-dup-409", cDup.status === 409, String(cDup.status));
    const pA = await post(`/api/admin/catalog/products`, {
      name: `BA11A Prod ${stamp}`, categoryId: idCat, productType: "PIECE", unit: "PIECE",
    }, ck);
    const idProd = pA.body.data.id;
    productIds.add(idProd);
    t("cat-prod-audit", pA.status === 201 && (await auditCount("products.create", idProd)) === 1);
    const pPatch = await patch(`/api/admin/catalog/products/${idProd}`, { name: `BA11A Prod ${stamp} X` }, ck);
    t("cat-prod-patch-audit", pPatch.status === 200 && (await auditCount("products.update", idProd)) === 1);
    const vHi = await post(`/api/admin/catalog/products/${idProd}/variants`, {
      name: "HI", price: "100.00", compareAtPrice: "150.00",
    }, ck);
    const idVHi = vHi.body.data.id;
    variantIds.add(idVHi);
    t("cat-variant-audit", vHi.status === 201 && (await auditCount("variants.create", idVHi)) === 1);
    const vLo = await post(`/api/admin/catalog/products/${idProd}/variants`, { name: "LO", price: "90.00" }, ck);
    const idVLo = vLo.body.data.id;
    variantIds.add(idVLo);
    const vPatch = await patch(`/api/admin/catalog/variants/${idVLo}`, { name: "LO2" }, ck);
    t("cat-variant-patch-audit", vPatch.status === 200 && (await auditCount("variants.update", idVLo)) === 1);
    const prA = await patch(`/api/admin/catalog/variants/${idVHi}/price`, { price: "110.00", reason: "BA11A" }, ck);
    t("cat-price-200", prA.status === 200, String(prA.status));
    t("cat-price-audit", (await auditCount("variants.price", idVHi)) === 1);
    const prHist = await q(`SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1::uuid`, [idVHi]);
    t("cat-price-history", prHist[0].n === 1);
    const prBad = await patch(`/api/admin/catalog/variants/${idVHi}/price`, { price: "999.00" }, ck);
    t("cat-price-cap-422", prBad.status === 422, String(prBad.status));
    t("cat-price-noaudit", (await auditCount("variants.price", idVHi)) === 1);
    const codeA = await post(`/api/admin/catalog/codes`, { productVariantId: idVHi, code: `81111${stamp}`.slice(0, 12), type: "BARCODE" }, ck);
    const idCode = codeA.body.data.id;
    t("cat-code-audit", codeA.status === 201 && (await auditCount("codes.create", idCode)) === 1);
    const codeDup = await post(`/api/admin/catalog/codes`, { productVariantId: idVHi, code: codeA.body.data.code, type: "BARCODE" }, ck);
    t("cat-code-dup-409", codeDup.status === 409, String(codeDup.status));
    const codeDel = await del(`/api/admin/catalog/codes/${idCode}`, ck);
    t("cat-code-delete-audit", codeDel.status === 200 && (await auditCount("codes.delete", idCode)) === 1);
    await db.query(`INSERT INTO inventory (id, product_variant_id, quantity, reserved_quantity)
      VALUES (gen_random_uuid(), $1::uuid, 50.000, 0), (gen_random_uuid(), $2::uuid, 50.000, 0)`, [idVHi, idVLo]);

    // ---------- inventory A/B (fixture P330) ----------
    const invId330 = (await q(`SELECT id::text AS id FROM inventory WHERE product_variant_id = $1::uuid`, [P330]))[0].id;
    const qBefore = (await invQty(P330)).qq;
    const adjBefore = await auditCount("inventory.adjust", invId330);
    const adjA = await post(`/api/admin/inventory/adjust`, {
      productVariantId: P330, delta: "5.000", movementType: "ADJUSTMENT", reason: "BA11A",
    }, ck);
    t("inv-adjust-201", adjA.status === 201, String(adjA.status));
    t("inv-adjust-audit", (await auditCount("inventory.adjust", invId330)) === adjBefore + 1);
    t("inv-adjust-state", (await invQty(P330)).qq === (Number(qBefore) + 5).toFixed(3));
    const adjB = await post(`/api/admin/inventory/adjust`, {
      productVariantId: P330, delta: "-999999.000", movementType: "WASTE", reason: "BA11A",
    }, ck);
    t("inv-adjust-short-409", adjB.status === 409, String(adjB.status));
    t("inv-adjust-noaudit", (await auditCount("inventory.adjust", invId330)) === adjBefore + 1);
    const resBefore = await auditCount("inventory.reserve", invId330);
    const resA = await post(`/api/admin/inventory/reserve`, { productVariantId: P330, quantity: "5.000" }, ck);
    t("inv-reserve-201", resA.status === 201, String(resA.status));
    t("inv-reserve-audit", (await auditCount("inventory.reserve", invId330)) === resBefore + 1);
    const relBefore = await auditCount("inventory.release", invId330);
    const relA = await post(`/api/admin/inventory/release`, { productVariantId: P330, quantity: "5.000" }, ck);
    t("inv-release-201", relA.status === 201, String(relA.status));
    t("inv-release-audit", (await auditCount("inventory.release", invId330)) === relBefore + 1);
    const relB = await post(`/api/admin/inventory/release`, { productVariantId: P330, quantity: "7.000" }, ck);
    t("inv-release-short-409", relB.status === 409, String(relB.status));
    t("inv-release-noaudit", (await auditCount("inventory.release", invId330)) === relBefore + 1);
    await post(`/api/admin/inventory/reserve`, { productVariantId: P330, quantity: "4.000" }, ck);
    const comBefore = await auditCount("inventory.commit", invId330);
    const comA = await post(`/api/admin/inventory/commit`, {
      productVariantId: P330, requested: "4.000", actual: "4.000", reason: "BA11A",
    }, ck);
    t("inv-commit-201", comA.status === 201, String(comA.status));
    t("inv-commit-audit", (await auditCount("inventory.commit", invId330)) === comBefore + 1);
    const comB = await post(`/api/admin/inventory/commit`, {
      productVariantId: P330, requested: "1.000", actual: "999999.000", reason: "BA11A",
    }, ck);
    t("inv-commit-bad-409or422", comB.status === 409 || comB.status === 422, String(comB.status));
    t("inv-commit-noaudit", (await auditCount("inventory.commit", invId330)) === comBefore + 1);
    const thBefore = await auditCount("inventory.threshold", invId330);
    const thA = await patch(`/api/admin/inventory/${P330}`, { lowStockThreshold: "42.000" }, ck);
    t("inv-threshold-200", thA.status === 200, String(thA.status));
    t("inv-threshold-audit", (await auditCount("inventory.threshold", invId330)) === thBefore + 1);
    const thB = await patch(`/api/admin/inventory/04800000-0000-7000-8000-000000009999`, { lowStockThreshold: "1.000" }, ck);
    t("inv-threshold-404", thB.status === 404, String(thB.status));
    await db.query(`UPDATE inventory SET low_stock_threshold = NULL WHERE product_variant_id = $1::uuid`, [P330]).catch(() => {});

    // ---------- customers A/B ----------
    const cu1 = await post(`/api/store/customers/identify`, { phone: P_A1, firstName: "Aud" });
    const idCu1 = cu1.body.data.id;
    const cuPatch = await patch(`/api/admin/customers/${idCu1}`, { firstName: "Audited" }, ck);
    t("cus-patch-audit", cuPatch.status === 200 && (await auditCount("customers.update", idCu1)) === 1, String(cuPatch.status));
    const cu2 = await post(`/api/store/customers/identify`, { phone: P_A2, firstName: "Aud2" });
    const idCu2 = cu2.body.data.id;
    const cuDup = await patch(`/api/admin/customers/${idCu1}`, { email: "dup-check@example.com" }, ck);
    t("cus-patch-ok", cuDup.status === 200, String(cuDup.status));
    const cuDup2 = await patch(`/api/admin/customers/${idCu2}`, { email: "dup-check@example.com" }, ck);
    t("cus-dup-email-409", cuDup2.status === 409, String(cuDup2.status));
    t("cus-noaudit", (await auditCount("customers.update", idCu2)) === 0);
    const regA = await post(`/api/admin/customers/${idCu2}/register`, { password: "Ba11a-Reg-Pass-0001!" }, ck);
    t("cus-register-audit", regA.status === 200 && (await auditCount("customers.register", idCu2)) === 1, String(regA.status));
    const regB = await post(`/api/admin/customers/${idCu2}/register`, { password: "Ba11a-Reg-Pass-0002!" }, ck);
    t("cus-register-dup-409", regB.status === 409, String(regB.status));
    const adA = await post(`/api/admin/customers/${idCu1}/addresses`, { city: "Matai", phone: P_A1 }, ck);
    const idAd = adA.body.data.id;
    t("cus-addr-create-audit", adA.status === 201 && (await auditCount("addresses.create", idAd)) === 1, String(adA.status));
    const adP = await patch(`/api/admin/customers/${idCu1}/addresses/${idAd}`, { city: "Matai2" }, ck);
    t("cus-addr-patch-audit", adP.status === 200 && (await auditCount("addresses.update", idAd)) === 1, String(adP.status));
    const adD = await del(`/api/admin/customers/${idCu1}/addresses/${idAd}`, ck);
    t("cus-addr-delete-audit", adD.status === 200 && (await auditCount("addresses.delete", idAd)) === 1, String(adD.status));
    const idAddr = (await post(`/api/admin/customers/${idCu1}/addresses`, { city: "Matai", phone: P_A1 }, ck)).body.data.id;

    // ---------- promotions A/B ----------
    const prmA = await post(`/api/admin/promotions`, {
      name: `BA11A Promo ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", priority: 10, usageLimit: 5,
    }, ck);
    const idPrm = prmA.body.data.id;
    promoIds.add(idPrm);
    t("prm-create-audit", prmA.status === 201 && (await auditCount("promotions.create", idPrm)) === 1, String(prmA.status));
    const prmBad = await post(`/api/admin/promotions`, {
      name: `BA11A Bad ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", status: "ACTIVE",
    }, ck);
    t("prm-active-422", prmBad.status === 422, String(prmBad.status));
    const prmPatch = await patch(`/api/admin/promotions/${idPrm}`, { priority: 11 }, ck);
    t("prm-patch-audit", prmPatch.status === 200 && (await auditCount("promotions.update", idPrm)) === 1, String(prmPatch.status));
    const tgtA = await post(`/api/admin/promotions/${idPrm}/targets`, { targetType: "VARIANT", targetId: P330 }, ck);
    const idTgt = tgtA.body.data.id;
    t("prm-target-audit", tgtA.status === 201 && (await auditCount("targets.create", idTgt)) === 1, String(tgtA.status));
    const tgtDup = await post(`/api/admin/promotions/${idPrm}/targets`, { targetType: "VARIANT", targetId: P330 }, ck);
    t("prm-target-dup-409", tgtDup.status === 409, String(tgtDup.status));
    const rulesA = await put(`/api/admin/promotions/${idPrm}/rules`, { minimumQuantity: "2" }, ck);
    t("prm-rules-audit", rulesA.status === 200 && (await auditCount("rules.update")) >= 1, String(rulesA.status));
    const bxgy = await post(`/api/admin/promotions`, { name: `BA11A BXGY ${stamp}`, type: "BUY_X_GET_Y", scope: "LINE" }, ck);
    const idBxgy = bxgy.body.data.id;
    promoIds.add(idBxgy);
    const bgA = await put(`/api/admin/promotions/${idBxgy}/buy-get`, {
      buyQuantity: "2", getQuantity: "1", discountPercent: "100.00",
    }, ck);
    t("prm-buyget-audit", bgA.status === 200 && (await auditCount("buyget.update")) >= 1, String(bgA.status));
    const tgtD = await del(`/api/admin/promotions/${idPrm}/targets/${idTgt}`, ck);
    t("prm-target-delete-audit", tgtD.status === 200 && (await auditCount("targets.delete", idTgt)) === 1, String(tgtD.status));
    const prmDel = await del(`/api/admin/promotions/${idBxgy}`, ck);
    t("prm-delete-audit", prmDel.status === 200 && (await auditCount("promotions.delete", idBxgy)) === 1, String(prmDel.status));
    promoIds.delete(idBxgy);

    // ---------- coupons A/B ----------
    const cpA = await post(`/api/admin/coupons`, { promotionId: idPrm, code: `BA11A${stamp}`.toUpperCase().slice(0, 12) }, ck);
    const idCp = cpA.body.data.id;
    couponIds.add(idCp);
    const cpCode = cpA.body.data.code;
    t("cp-create-audit", cpA.status === 201 && (await auditCount("coupons.create", idCp)) === 1, String(cpA.status));
    const cpDup = await post(`/api/admin/coupons`, { promotionId: idPrm, code: cpCode }, ck);
    t("cp-dup-409", cpDup.status === 409, String(cpDup.status));
    t("cp-noaudit", (await auditCount("coupons.create")) >= 1);
    const cpDis = await patch(`/api/admin/coupons/${idCp}`, { isActive: false }, ck);
    t("cp-patch-audit", cpDis.status === 200 && (await auditCount("coupons.update", idCp)) === 1, String(cpDis.status));
    await patch(`/api/admin/coupons/${idCp}`, { isActive: true }, ck);
    const cpDel = await del(`/api/admin/coupons/${idCp}`, ck);
    t("cp-delete-audit", cpDel.status === 200 && (await auditCount("coupons.delete", idCp)) === 1, String(cpDel.status));
    couponIds.delete(idCp);

    // ---------- orders A/B (admin cancel pairs; customer cancel stays clean) ----------
    const o1 = await checkout(idCu1, idAddr, [[P330, "1"]], key("o1"));
    t("ord-checkout-201", o1.status === 201, String(o1.status));
    const idO1 = o1.body.data.order.id;
    const cxA = await post(`/api/admin/orders/${idO1}/cancel`, {}, cko);
    t("ord-cancel-200", cxA.status === 200, String(cxA.status));
    t("ord-cancel-audit", (await auditCount("orders.cancel", idO1)) === 1);
    const cxB = await post(`/api/admin/orders/${idO1}/cancel`, {}, cko);
    t("ord-cancel-again-409", cxB.status === 409, String(cxB.status));
    t("ord-cancel-noaudit", (await auditCount("orders.cancel", idO1)) === 1);
    const o1c = await checkout(idCu1, idAddr, [[P330, "1"]], key("o1c"));
    const idO1c = o1c.body.data.order.id;
    const cxC = await post(`/api/store/orders/${idO1c}/cancel`, { customerId: idCu1 },);
    t("ord-cust-cancel-200", cxC.status === 200, String(cxC.status));
    t("ord-cust-cancel-clean", (await auditCount("orders.cancel", idO1c)) === 0);

    // ---------- replacements A/B ----------
    const o2 = await checkout(idCu1, idAddr, [[P330, "1"]], key("o2"));
    const idO2 = o2.body.data.order.id;
    const itemsO2 = await orderItemsOf(idO2, idCu1);
    const rpA = await post(`/api/admin/orders/${idO2}/items/${itemsO2[0].id}/replacements`, {
      replacementVariantId: P1L, replacementQuantity: "1",
    }, ck);
    const idRp = rpA.body.data.id;
    repIds.add(idRp);
    t("rep-propose-audit", rpA.status === 201 && (await auditCount("replacements.propose", idRp)) === 1, String(rpA.status));
    const rpB = await post(`/api/admin/orders/${idO2}/items/${itemsO2[0].id}/replacements`, {
      replacementVariantId: P1L, replacementQuantity: "1",
    }, ck);
    t("rep-propose-dup-409", rpB.status === 409, String(rpB.status));
    t("rep-propose-noaudit", (await auditCount("replacements.propose")) >= 1);
    const wdA = await post(`/api/admin/replacements/${idRp}/withdraw`, {}, ck);
    t("rep-withdraw-audit", wdA.status === 200 && (await auditCount("replacements.withdraw", idRp)) === 1, String(wdA.status));
    const wdB = await post(`/api/admin/replacements/${idRp}/withdraw`, {}, ck);
    t("rep-withdraw-again-409", wdB.status === 409, String(wdB.status));
    t("rep-withdraw-noaudit", (await auditCount("replacements.withdraw", idRp)) === 1);

    // ---------- auto-accept A (own fixtures, negative delta => covered) ----------
    await patch(`/api/admin/customers/${idCu1}`, { autoAcceptReplacements: true }, ck);
    const oAA = await checkout(idCu1, idAddr, [[idVHi, "1"]], key("oaa"));
    t("aa-checkout-201", oAA.status === 201, String(oAA.status));
    const idOAA = oAA.body.data.order.id;
    const itemsAA = await orderItemsOf(idOAA, idCu1);
    const rpAA = await post(`/api/admin/orders/${idOAA}/items/${itemsAA[0].id}/replacements`, {
      replacementVariantId: idVLo, replacementQuantity: "1",
    }, ck);
    const idRpAA = rpAA.body.data.id;
    repIds.add(idRpAA);
    const aaA = await post(`/api/admin/replacements/${idRpAA}/auto-accept`, {}, ck);
    t("aa-200", aaA.status === 200, String(aaA.status));
    t("aa-audit", (await auditCount("replacements.auto_accept", idRpAA)) === 1);
    const aaRow = await q(`SELECT status FROM order_item_replacements WHERE id = $1::uuid`, [idRpAA]);
    t("aa-state", aaRow[0].status === "AUTO_ACCEPTED");

    // ---------- C: forced audit failure (trigger window, no logins inside) ----------
    await installAuditBomb();
    try {
      const cBrandBefore = await auditCount("brands.create");
      const cBrand = await post(`/api/admin/catalog/brands`, { name: `BA11A Bomb ${stamp}` }, ck);
      t("c-brand-500", cBrand.status === 500, String(cBrand.status));
      t("c-brand-rolledback", (await q(`SELECT count(*)::int AS n FROM brands WHERE name = $1`, [`BA11A Bomb ${stamp}`]))[0].n === 0
        && (await auditCount("brands.create")) === cBrandBefore);
      const qCBefore = (await invQty(P330)).qq;
      const cAdjBefore = await auditCount("inventory.adjust", invId330);
      const cAdj = await post(`/api/admin/inventory/adjust`, {
        productVariantId: P330, delta: "1.000", movementType: "ADJUSTMENT", reason: "BA11A",
      }, ck);
      t("c-adjust-500", cAdj.status === 500, String(cAdj.status));
      t("c-adjust-rolledback", (await invQty(P330)).qq === qCBefore && (await auditCount("inventory.adjust", invId330)) === cAdjBefore);
      const cCusBefore = await auditCount("customers.update", idCu1);
      const cCus = await patch(`/api/admin/customers/${idCu1}`, { firstName: "Bombed" }, ck);
      t("c-customer-500", cCus.status === 500, String(cCus.status));
      const cCusRow = await q(`SELECT first_name FROM customers WHERE id = $1::uuid`, [idCu1]);
      t("c-customer-rolledback", cCusRow[0].first_name === "Audited" && (await auditCount("customers.update", idCu1)) === cCusBefore);
      const cPrmBefore = await auditCount("promotions.create");
      const cPrm = await post(`/api/admin/promotions`, {
        name: `BA11A BombP ${stamp}`, type: "PERCENTAGE", scope: "LINE", discountPercent: "5.00",
      }, ck);
      t("c-promo-500", cPrm.status === 500, String(cPrm.status));
      t("c-promo-rolledback", (await q(`SELECT count(*)::int AS n FROM promotions WHERE name = $1`, [`BA11A BombP ${stamp}`]))[0].n === 0
        && (await auditCount("promotions.create")) === cPrmBefore);
      const cCpBefore = await auditCount("coupons.create");
      const cCp = await post(`/api/admin/coupons`, { promotionId: idPrm, code: `BOMB${stamp}`.toUpperCase().slice(0, 12) }, ck);
      t("c-coupon-500", cCp.status === 500, String(cCp.status));
      t("c-coupon-rolledback", (await auditCount("coupons.create")) === cCpBefore);
      const cRpBefore = await auditCount("replacements.propose");
      const cRp = await post(`/api/admin/orders/${idO2}/items/${itemsO2[0].id}/replacements`, {
        replacementVariantId: P1L, replacementQuantity: "1",
      }, ck);
      t("c-propose-500", cRp.status === 500, String(cRp.status));
      t("c-propose-rolledback", (await q(`SELECT count(*)::int AS n FROM order_item_replacements WHERE order_item_id = $1::uuid AND status = 'PROPOSED'`, [itemsO2[0].id]))[0].n === 0
        && (await auditCount("replacements.propose")) === cRpBefore);
      const cCxBefore = await auditCount("orders.cancel", idO2);
      const cCx = await post(`/api/admin/orders/${idO2}/cancel`, {}, cko);
      t("c-cancel-500", cCx.status === 500, String(cCx.status));
      const cCxRow = await q(`SELECT status FROM orders WHERE id = $1::uuid`, [idO2]);
      t("c-cancel-rolledback", cCxRow[0].status !== "CANCELLED" && (await auditCount("orders.cancel", idO2)) === cCxBefore);
    } finally {
      await dropAuditBomb();
    }
    const bombGone = await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tmp_ba11a_audit_fail_trg'`);
    t("c-bomb-removed", bombGone[0].n === 0);

    // ---------- concurrency ----------
    const ccB1 = await post(`/api/admin/catalog/brands`, { name: `BA11A CC1 ${stamp}` }, ck);
    const ccB2 = await post(`/api/admin/catalog/brands`, { name: `BA11A CC2 ${stamp}` }, ck);
    brandIds.add(ccB1.body.data.id);
    brandIds.add(ccB2.body.data.id);
    t("cc-same-ok", ccB1.status === 201 && ccB2.status === 201, `${ccB1.status}/${ccB2.status}`);
    t("cc-same-audits", (await auditCount("brands.create", ccB1.body.data.id)) === 1
      && (await auditCount("brands.create", ccB2.body.data.id)) === 1);
    const [ccRd, ccWr] = await Promise.all([
      get(`/api/admin/audit-logs?action=brands.create&limit=5`, cko),
      patch(`/api/admin/catalog/brands/${idBrand}`, { name: `BA11A Brand ${stamp} R2` }, ck),
    ]);
    t("cc-read-write", ccRd.status === 200 && ccWr.status === 200, `${ccRd.status}/${ccWr.status}`);
    await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]);
    const ccResBefore = await auditCount("inventory.reserve", invId330);
    const [ccR1, ccR2] = await Promise.all([
      post(`/api/admin/inventory/reserve`, { productVariantId: P330, quantity: "400.000" }, ck),
      post(`/api/admin/inventory/reserve`, { productVariantId: P330, quantity: "400.000" }, ck),
    ]);
    const resCodes = [ccR1.status, ccR2.status].sort().join(",");
    t("cc-conflict", resCodes === "201,409", resCodes);
    t("cc-winner-audit-only", (await auditCount("inventory.reserve", invId330)) === ccResBefore + 1);
    const wU = await post(`/api/admin/users`, { name: "BA11A W", email: `ba11a-w-${stamp}@example.com` }, cko);
    const idW = wU.body.data.id;
    userIds.add(idW);
    const rQ = await post(`/api/admin/roles`, { name: `BA11A_Q_${stamp}`.toUpperCase() }, cko);
    const idQ = rQ.body.data.id;
    roleIds.add(idQ);
    const [ccAs, ccPa] = await Promise.all([
      post(`/api/admin/users/${idW}/roles`, { roleId: idQ }, cko),
      patch(`/api/admin/users/${idW}`, { name: "BA11A W2" }, cko),
    ]);
    t("cc-rbac-race", (ccAs.status === 201 || ccAs.status === 409) && ccPa.status === 200, `${ccAs.status}/${ccPa.status}`);
    const ccAsRow = await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'users.role_assign' AND entity_id = $1::uuid`, [idW]);
    const ccPaRow = await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'users.update' AND entity_id = $1::uuid`, [idW]);
    t("cc-rbac-audits", (ccAs.status === 201 ? ccAsRow[0].n === 1 : ccAsRow[0].n === 0) && ccPaRow[0].n === 1,
      `${ccAsRow[0].n}/${ccPaRow[0].n}`);
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      const movIdsAfter = (await q(`SELECT id::text AS id FROM inventory_movements`)).map((r) => r.id);
      const myMov = movIdsAfter.filter((id) => !movIdsBefore.has(id));
      if (myMov.length > 0) {
        await db.query(`DELETE FROM inventory_movements WHERE id = ANY($1::uuid[])`, [myMov]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone IN ($1, $2)`, [CANON(P_A1), CANON(P_A2)],
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
      // Test-variant inventory rows first (RESTRICT pins variants).
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
      for (const phone of [CANON(P_A1), CANON(P_A2)]) {
        const cust = await db.query(`SELECT id FROM customers WHERE phone = $1`, [phone]).catch(() => ({ rows: [] }));
        for (const r of cust.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
          for (const c of cc.rows) {
            await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
            await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
          }
        }
        await db.query(`DELETE FROM customers WHERE phone = $1`, [phone]).catch(() => {});
      }
      for (const uid of userIds) {
        await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      }
      for (const rid of roleIds) {
        await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM roles WHERE id = $1`, [rid]).catch(() => {});
      }
      for (const email of [STORE_EMAIL, OWNER_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
      for (const v of [P330, P1L]) {
        await db.query(`UPDATE inventory SET quantity = $2, reserved_quantity = $3 WHERE product_variant_id = $1`,
          [v, invSnap[v].qq, invSnap[v].rr]).catch(() => {});
      }
      await db.query(`UPDATE inventory SET low_stock_threshold = NULL WHERE product_variant_id = $1`, [P330]).catch(() => {});
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`AUDIT_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  done(1);
});
