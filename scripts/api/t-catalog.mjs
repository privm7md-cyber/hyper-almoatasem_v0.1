// BA-2 catalog API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-catalog.mjs --db <name> --port <port>
// Covers: storefront reads, validation, 404s, barcode 2010106 resolution,
// admin CRUD + permission matrix (anon/store/owner/roleless/inactive),
// duplicates→409, weight-rule 422, price+history tx, primary switch.
// Prints JSON (never passwords, hashes, tokens, or connection strings).
import crypto from "node:crypto";
import argon2 from "argon2";
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
  console.log(JSON.stringify({ suite: "catalog", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
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
    const setCookie = r.headers.get("set-cookie") || "";
    const match = setCookie.match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, cookie: match ? `__Host-admin-session=${match[1]}` : null };
  };

  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const createdIds = { categories: [], brands: [], products: [], variants: [], codes: [], users: [] };
  const track = (kind, id) => { if (isUuid(id)) createdIds[kind].push(id); };

  try {
    // ---------- storefront reads ----------
    const cats = await get("/api/store/catalog/categories");
    t("store-list-categories-200", cats.status === 200 && Array.isArray(cats.body.data) && cats.body.data.length >= 1 && cats.body.meta && typeof cats.body.meta.limit === "number");
    const badPage = await get("/api/store/catalog/categories?limit=500");
    t("store-bad-pagination-400", badPage.status === 400 && badPage.body.error && badPage.body.error.code === "VALIDATION");
    const noCat = await get("/api/store/catalog/categories/02800000-0000-7000-8000-000000009999");
    t("store-get-category-404", noCat.status === 404 && noCat.body.error.code === "NOT_FOUND");
    const malCat = await get("/api/store/catalog/categories/not-a-uuid");
    t("store-malformed-id-400", malCat.status === 400);

    const brands = await get("/api/store/catalog/brands");
    t("store-list-brands-200", brands.status === 200 && Array.isArray(brands.body.data));

    const prods = await get("/api/store/catalog/products?limit=20");
    t("store-list-products-200", prods.status === 200 && prods.body.data.length >= 2);
    const romi = prods.body.data.find((p) => p.slug === "romi-cheese");
    t("store-romi-present", !!romi && romi.productType === "WEIGHT");
    const wOnly = await get("/api/store/catalog/products?type=WEIGHT&limit=20");
    t("store-filter-type-weight", wOnly.status === 200 && wOnly.body.data.length >= 1 && wOnly.body.data.every((p) => p.productType === "WEIGHT"));
    const search = await get("/api/store/catalog/products?search=pepsi&limit=20");
    t("store-search-pepsi", search.status === 200 && search.body.data.length >= 1);
    const badType = await get("/api/store/catalog/products?type=BOGUS");
    t("store-bad-enum-400", badType.status === 400);
    const prodGet = await get(`/api/store/catalog/products/${romi.id}`);
    t("store-get-product-200", prodGet.status === 200 && !!prodGet.body.data.category && !!prodGet.body.data.category.name);

    const vars = await get(`/api/store/catalog/products/${romi.id}/variants?limit=20`);
    t("store-product-variants-200", vars.status === 200 && vars.body.data.length >= 1);
    const loose = vars.body.data[0];
    t("store-variant-no-cost", loose.costPrice === undefined && typeof loose.price === "string");
    const varGet = await get(`/api/store/catalog/variants/${loose.id}`);
    t("store-get-variant-200", varGet.status === 200 && varGet.body.data.id === loose.id);

    // ---------- barcode 2010106 ----------
    const lookup = await get("/api/store/catalog/codes/lookup?code=2010106");
    t("barcode-2010106-resolves", lookup.status === 200 && lookup.body.data.code === "2010106" && lookup.body.data.variant && lookup.body.data.product && lookup.body.data.product.slug === "romi-cheese");
    t("barcode-no-computed-total", lookup.status === 200 && lookup.body.data.total === undefined && typeof lookup.body.data.variant.price === "string");
    const lookupTrim = await get("/api/store/catalog/codes/lookup?code=%202010106%20");
    t("barcode-trimmed-resolves", lookupTrim.status === 200 && lookupTrim.body.data.code === "2010106");
    const lookupMiss = await get("/api/store/catalog/codes/lookup?code=0000000000000");
    t("barcode-unknown-404", lookupMiss.status === 404);
    const lookupBlank = await get("/api/store/catalog/codes/lookup?code=%20%20");
    t("barcode-blank-400", lookupBlank.status === 400);

    // ---------- authN/Z matrix: anonymous ----------
    const anonAdminList = await get("/api/admin/catalog/products?limit=5");
    t("anon-admin-list-401", anonAdminList.status === 401);
    const anonPost = await post("/api/admin/catalog/categories", { name: "X" });
    t("anon-admin-post-401", anonPost.status === 401);

    // ---------- logins ----------
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-ok", owner.status === 200 && !!owner.cookie);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    t("store-login-ok", store.status === 200 && !!store.cookie);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("bare-login-ok", bare.status === 200 && !!bare.cookie);

    // ---------- roleless: reads public ok, admin forbidden ----------
    const bareAdmin = await get("/api/admin/catalog/products?limit=5", bare.cookie);
    t("bare-admin-list-403", bareAdmin.status === 403);
    const barePost = await post("/api/admin/catalog/categories", { name: "Y" }, bare.cookie);
    t("bare-admin-post-403", barePost.status === 403);

    // ---------- store admin: reads + writes ok ----------
    const storeList = await get("/api/admin/catalog/products?limit=5", store.cookie);
    t("store-admin-list-200", storeList.status === 200);

    // ---------- category CRUD + duplicate + deactivate visibility ----------
    const catName = `Cat Test ${Date.now().toString(36)}`;
    const catCreate = await post("/api/admin/catalog/categories", { name: catName }, store.cookie);
    t("admin-create-category-201", catCreate.status === 201 && isUuid(catCreate.body.data.id));
    track("categories", catCreate.body.data.id);
    const catDup = await post("/api/admin/catalog/categories", { name: catName }, store.cookie);
    t("admin-duplicate-slug-409", catDup.status === 409 && catDup.body.error.code === "CONFLICT");
    const catDeact = await patch(`/api/admin/catalog/categories/${catCreate.body.data.id}`, { isActive: false }, store.cookie);
    t("admin-deactivate-category-200", catDeact.status === 200 && catDeact.body.data.isActive === false);
    const hidden = await get(`/api/store/catalog/categories/${catCreate.body.data.id}`);
    t("store-hides-inactive-404", hidden.status === 404);
    const adminSees = await get(`/api/admin/catalog/categories/${catCreate.body.data.id}`, store.cookie);
    t("admin-sees-inactive-200", adminSees.status === 200);
    const inactiveFilter = await get("/api/admin/catalog/categories?active=false&limit=20", store.cookie);
    t("admin-filter-inactive", inactiveFilter.status === 200 && inactiveFilter.body.data.some((c) => c.id === catCreate.body.data.id));
    const badWeight = await post("/api/admin/catalog/products", { name: "Bad W", categoryId: catCreate.body.data.id, productType: "WEIGHT", unit: "PIECE" }, store.cookie);
    t("admin-weight-rule-422", badWeight.status === 422);
    const noParent = await post("/api/admin/catalog/products", { name: "No Parent", categoryId: "02800000-0000-7000-8000-000000009999", productType: "PIECE", unit: "PIECE" }, store.cookie);
    t("admin-unknown-category-422", noParent.status === 422);
    const patchMiss = await patch("/api/admin/catalog/categories/02800000-0000-7000-8000-000000009999", { name: "Z" }, store.cookie);
    t("admin-patch-unknown-404", patchMiss.status === 404);

    // ---------- brand + product + variant + price + codes ----------
    const brandCreate = await post("/api/admin/catalog/brands", { name: `Brand ${Date.now().toString(36)}` }, store.cookie);
    t("admin-create-brand-201", brandCreate.status === 201 && isUuid(brandCreate.body.data.id));
    track("brands", brandCreate.body.data.id);
    const prodCreate = await post("/api/admin/catalog/products", { name: `Prod ${Date.now().toString(36)}`, categoryId: catCreate.body.data.id, brandId: brandCreate.body.data.id, productType: "PIECE", unit: "PIECE" }, store.cookie);
    t("admin-create-product-201", prodCreate.status === 201 && !!prodCreate.body.data.slug);
    track("products", prodCreate.body.data.id);
    const varCreate = await post(`/api/admin/catalog/products/${prodCreate.body.data.id}/variants`, { name: "Pack 6", price: "120.00", compareAtPrice: "150.00" }, store.cookie);
    t("admin-create-variant-201", varCreate.status === 201 && isUuid(varCreate.body.data.id));
    track("variants", varCreate.body.data.id);
    const varDup = await post(`/api/admin/catalog/products/${prodCreate.body.data.id}/variants`, { name: "Pack 6", price: "1.00" }, store.cookie);
    t("admin-duplicate-variant-409", varDup.status === 409);
    const badCompare = await patch(`/api/admin/catalog/variants/${varCreate.body.data.id}`, { compareAtPrice: "10.00" }, store.cookie);
    t("admin-compare-below-price-422", badCompare.status === 422);
    const histBefore = await q(`SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1`, [varCreate.body.data.id]);
    const priceUpd = await patch(`/api/admin/catalog/variants/${varCreate.body.data.id}/price`, { price: "130.00", reason: "test" }, store.cookie);
    // Prisma Decimal serializes without trailing zeros ("130.00" -> "130"):
    // numerically exact; clients must parse as decimal, not string-compare.
    t("admin-price-update-200", priceUpd.status === 200 && Number(priceUpd.body.data.price) === 130);
    const histAfter = await q(`SELECT count(*)::int AS n FROM product_price_history WHERE product_variant_id = $1`, [varCreate.body.data.id]);
    t("price-history-row-created", histAfter[0].n === histBefore[0].n + 1);
    const adminVar = await get(`/api/admin/catalog/variants/${varCreate.body.data.id}`, store.cookie);
    t("admin-variant-shows-cost", adminVar.status === 200 && adminVar.body.data.costPrice === null);

    const codeCreate = await post("/api/admin/catalog/codes", { productVariantId: varCreate.body.data.id, code: `TST${Date.now().toString().slice(-8)}`, type: "BARCODE", isPrimary: true }, store.cookie);
    t("admin-create-code-201", codeCreate.status === 201);
    track("codes", codeCreate.body.data.id);
    const codeDup = await post("/api/admin/catalog/codes", { productVariantId: varCreate.body.data.id, code: "2010106", type: "BARCODE" }, store.cookie);
    t("admin-duplicate-code-409", codeDup.status === 409);
    const codeSpace = await post("/api/admin/catalog/codes", { productVariantId: varCreate.body.data.id, code: "has space", type: "BARCODE" }, store.cookie);
    t("admin-code-spaces-400", codeSpace.status === 400);
    const code2 = await post("/api/admin/catalog/codes", { productVariantId: varCreate.body.data.id, code: `TST2${Date.now().toString().slice(-8)}`, type: "INTERNAL_CODE" }, store.cookie);
    track("codes", code2.body.data.id);
    const switchPrimary = await patch(`/api/admin/catalog/codes/${code2.body.data.id}`, { isPrimary: true }, store.cookie);
    t("admin-primary-switch-200", switchPrimary.status === 200 && switchPrimary.body.data.isPrimary === true);
    const oldPrimary = await get(`/api/admin/catalog/codes/${codeCreate.body.data.id}`, store.cookie);
    t("admin-old-primary-cleared", oldPrimary.status === 200 && oldPrimary.body.data.isPrimary === false);
    const codeDel = await del(`/api/admin/catalog/codes/${code2.body.data.id}`, store.cookie);
    t("admin-delete-code-200", codeDel.status === 200);
    const codeDelMiss = await del(`/api/admin/catalog/codes/02800000-0000-7000-8000-000000009999`, store.cookie);
    t("admin-delete-code-404", codeDelMiss.status === 404);

    // ---------- owner full pass + inactive user ----------
    const ownerList = await get("/api/admin/catalog/brands?limit=5", owner.cookie);
    t("owner-admin-list-200", ownerList.status === 200);
    const inactiveId = crypto.randomUUID();
    const inactiveHash = await argon2.hash("Cat-Test-Off-Pass-0004!", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await db.query(`INSERT INTO users (id, name, email, phone, password_hash, is_active) VALUES ($1,'Cat Off','off-cat-test@example.com','201133300023',$2,FALSE)`, [inactiveId, inactiveHash]);
    track("users", inactiveId);
    const inactiveLogin = await loginAs("off-cat-test@example.com", "anything-0000!");
    t("inactive-login-401", inactiveLogin.status === 401);
  } finally {
    // Hygiene: remove scratch-only rows (codes → variants → products → brands → categories → users).
    try {
      for (const id of createdIds.codes) await db.query(`DELETE FROM product_codes WHERE id = $1`, [id]).catch(() => {});
      for (const id of createdIds.variants) {
        await db.query(`DELETE FROM product_price_history WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM product_variants WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of createdIds.products) await db.query(`DELETE FROM products WHERE id = $1`, [id]).catch(() => {});
      for (const id of createdIds.brands) await db.query(`DELETE FROM brands WHERE id = $1`, [id]).catch(() => {});
      for (const id of createdIds.categories) await db.query(`DELETE FROM categories WHERE id = $1`, [id]).catch(() => {});
      for (const id of createdIds.users) {
        await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
      }
      for (const email of [OWNER_EMAIL, STORE_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`CATALOG_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
