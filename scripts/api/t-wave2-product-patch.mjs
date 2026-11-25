// Wave-2 integration suite (BL-02 — GD-2 PATCH contract extension).
// Phase_12_Full_Execution mission — isolated test DB only.
// Doc 12 §B authorizing tests: (a) legal re-type roundtrip; (b) illegal state
// combos rejected 422/400; (c) concurrency token (If-Match) enforcement 409;
// (d) audit row contains true old+new incl. the sale-usage transition;
// (e) a rejected PATCH leaves the row byte-unchanged (no write, no audit).
// Plus: ETag discoverability + cart sale-step interplay after re-typing.
import crypto from "node:crypto";
import { extractSessionCookie } from "./_session-cookie.mjs";
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
  console.log(JSON.stringify({ suite: "wave2-product-patch", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_p12full_execution",
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_e2e_20261106",
  "hyper_almoatasem_closure_20261030",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";

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
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const post = async (path, data, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const patch = async (path, data, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const setCookie = r.headers.get("set-cookie") || "";
    const ck = extractSessionCookie(setCookie);
    return { status: r.status, cookie: ck ? ck.header : null };
  };

  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const createdIds = { categories: [], products: [], variants: [] };
  const track = (kind, id) => { if (isUuid(id)) createdIds[kind].push(id); };

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-ok", owner.status === 201 && !!owner.cookie);
    const anonPatch = await patch(`/api/admin/catalog/products/${crypto.randomUUID()}`, { isActive: false });
    t("anon-patch-401", anonPatch.status === 401);

    // host + product under test
    const cat = (await q(`SELECT id FROM categories ORDER BY created_at LIMIT 1`))[0];
    const stamp = Date.now().toString(36);
    const prod = await post("/api/admin/catalog/products", { name: `W2 ${stamp}`, categoryId: cat.id, productType: "PIECE", unit: "PIECE" }, owner.cookie);
    t("fixture-product-created", prod.status === 201 && isUuid(prod.body.data?.id), JSON.stringify(prod.body).slice(0, 160));
    const pid = prod.body.data.id;
    track("products", pid);
    const variant = await post(`/api/admin/catalog/products/${pid}/variants`, { name: "Pack", price: "10.00" }, owner.cookie);
    track("variants", variant.body.data?.id);

    const detail = await get(`/api/admin/catalog/products/${pid}`, owner.cookie);
    const etag0 = detail.headers.get("etag");
    t("bl02-get-etag-present", typeof etag0 === "string" && etag0.startsWith('"') && etag0.endsWith('"'));

    // (b) illegal combos — rejected BEFORE any write
    const b1 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "WEIGHT" }, owner.cookie);
    t("bl02-weight-alone-422", b1.status === 422 && b1.body.error?.code === "BUSINESS_RULE");
    const b2 = await patch(`/api/admin/catalog/products/${pid}`, { unit: "KG" }, owner.cookie);
    t("bl02-unit-alone-422", b2.status === 422);
    const b3 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "WEIGHT", unit: "LITER", saleStepGrams: 100 }, owner.cookie);
    t("bl02-weight-liter-400", b3.status === 400);
    const b4 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "WEIGHT", unit: "KG", saleStepGrams: 0 }, owner.cookie);
    t("bl02-step-zero-400", b4.status === 400);
    const b5 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "WEIGHT", unit: "KG", saleStepGrams: -5 }, owner.cookie);
    t("bl02-step-negative-400", b5.status === 400);
    const b6 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "PIECE", unit: "PIECE", saleStepGrams: 250 }, owner.cookie);
    t("bl02-piece-with-step-422", b6.status === 422);
    const b7 = await patch(`/api/admin/catalog/products/${pid}`, { saleStepGrams: 250 }, owner.cookie);
    t("bl02-step-alone-on-piece-422", b7.status === 422);
    const b8 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "WEIGHT", unit: "KG" }, owner.cookie);
    t("bl02-weight-without-step-422", b8.status === 422);

    // (e) the rejections left the row untouched: no write, no audit
    const afterRejects = await get(`/api/admin/catalog/products/${pid}`, owner.cookie);
    t("bl02-rejects-no-write", afterRejects.headers.get("etag") === etag0 && afterRejects.body.data.productType === "PIECE" && afterRejects.body.data.unit === "PIECE");
    const rejectAuditCount = Number((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'products.update' AND entity_id = $1`, [pid]))[0].n);
    t("bl02-rejects-no-audit", rejectAuditCount === 0);

    // (c) concurrency token
    const stale = await patch(`/api/admin/catalog/products/${pid}`, { name: `W2 ${stamp} stale` }, owner.cookie, { "if-match": `"2000-01-01T00:00:00.000Z"` });
    t("bl02-stale-token-409", stale.status === 409 && stale.body.error?.code === "CONFLICT" && typeof stale.body.error?.details?.currentUpdatedAt === "string");
    const malformed = await patch(`/api/admin/catalog/products/${pid}`, { name: `W2 ${stamp} malformed` }, owner.cookie, { "if-match": `"not-a-date"` });
    t("bl02-malformed-token-409", malformed.status === 409);
    // body key fallback + correct token → 200
    const current0 = afterRejects.headers.get("etag").replace(/"/g, "");
    const bodyKey = await patch(`/api/admin/catalog/products/${pid}`, { name: `W2 ${stamp} bk`, expectedUpdatedAt: current0 }, owner.cookie);
    t("bl02-body-key-token-200", bodyKey.status === 200 && bodyKey.body.data.name === `W2 ${stamp} bk`);
    const etag1 = bodyKey.headers.get("etag");
    t("bl02-patch-etag-rotates", typeof etag1 === "string" && etag1 !== `"${current0}"`);

    // (a) legal re-type roundtrip PIECE → WEIGHT/KG/250 → back
    const corr = `w2-${stamp}`;
    const retype = await patch(
      `/api/admin/catalog/products/${pid}`,
      { productType: "WEIGHT", unit: "KG", saleStepGrams: 250 },
      owner.cookie,
      { "if-match": etag1, "x-correlation-id": corr },
    );
    t("bl02-retype-200", retype.status === 200 && retype.body.data.productType === "WEIGHT" && retype.body.data.unit === "KG" && retype.body.data.saleStepGrams === 250, JSON.stringify(retype.body).slice(0, 200));
    const retypeAudit = (
      await q(`SELECT old_values, new_values FROM audit_logs WHERE action = 'products.update' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [pid])
    )[0];
    t("bl02-audit-old-transition", retypeAudit?.old_values?.productType === "PIECE" && retypeAudit?.old_values?.unit === "PIECE" && retypeAudit?.old_values?.saleStepGrams === null);
    t("bl02-audit-new-transition", retypeAudit?.new_values?.productType === "WEIGHT" && retypeAudit?.new_values?.unit === "KG" && retypeAudit?.new_values?.saleStepGrams === 250);
    t("bl02-audit-correlation", retypeAudit?.new_values?.correlation_id === corr);

    // GRAM is a legal WEIGHT unit too (CHECK mirror; doc 12 example is KG-only — logged)
    const gramRe = await patch(`/api/admin/catalog/products/${pid}`, { unit: "GRAM" }, owner.cookie, { "if-match": retype.headers.get("etag") });
    t("bl02-weight-gram-legal-200", gramRe.status === 200 && gramRe.body.data.unit === "GRAM");
    const back = await patch(`/api/admin/catalog/products/${pid}`, { productType: "PIECE", unit: "PIECE", saleStepGrams: null }, owner.cookie, { "if-match": gramRe.headers.get("etag") });
    t("bl02-roundtrip-back-200", back.status === 200 && back.body.data.productType === "PIECE" && back.body.data.unit === "PIECE" && back.body.data.saleStepGrams === null);
    const backAudit = (
      await q(`SELECT old_values, new_values FROM audit_logs WHERE action = 'products.update' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [pid])
    )[0];
    t("bl02-back-audit-clear", backAudit?.old_values?.saleStepGrams === 250 && backAudit?.new_values?.saleStepGrams === null);

    // price stays on /price (PATCH must not carry price)
    const priceAttempt = await patch(`/api/admin/catalog/products/${pid}`, { price: "1.00" }, owner.cookie);
    t("bl02-price-not-patchable-400", priceAttempt.status === 400);

    // cart interplay: re-type to WEIGHT/KG/step 250 → cart add honours the step.
    // The variant's sizeUnit is package-size metadata; for a WEIGHT product
    // the cart gate requires it (KG) before a line can be added.
    const retype2 = await patch(`/api/admin/catalog/products/${pid}`, { productType: "WEIGHT", unit: "KG", saleStepGrams: 250 }, owner.cookie, { "if-match": back.headers.get("etag") });
    t("bl02-retype2-200", retype2.status === 200);
    const sizeUnitFix = await patch(`/api/admin/catalog/variants/${variant.body.data.id}`, { sizeUnit: "KG" }, owner.cookie);
    t("bl02-variant-sizeunit-set", sizeUnitFix.status === 200);
    const guestCart = await post("/api/store/cart", {});
    const guestToken = guestCart.body.data?.guestToken;
    t("bl02-guest-cart-created", guestCart.status === 201 && typeof guestToken === "string", JSON.stringify(guestCart.body).slice(0, 160));
    const guestHeaders = { "x-guest-token": guestToken };
    const badQty = await post(`/api/store/cart/items`, { productVariantId: variant.body.data.id, quantity: "0.3" }, null, guestHeaders);
    t("bl02-cart-step-violation-422", badQty.status === 422, JSON.stringify(badQty.body).slice(0, 160));
    const okQty = await post(`/api/store/cart/items`, { productVariantId: variant.body.data.id, quantity: "0.25" }, null, guestHeaders);
    t("bl02-cart-step-ok", okQty.status === 200, JSON.stringify(okQty.body).slice(0, 200));
  } finally {
    try {
      for (const id of createdIds.variants) {
        await db.query(`DELETE FROM cart_items WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM product_price_history WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'product_variants' AND entity_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM product_variants WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of createdIds.products) {
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'products' AND entity_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM products WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of createdIds.categories) {
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'categories' AND entity_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM categories WHERE id = $1`, [id]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`WAVE2_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
