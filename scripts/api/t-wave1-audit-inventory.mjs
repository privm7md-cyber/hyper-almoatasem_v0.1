// Wave-1 integration suite (BL-01 audit hardening + BL-05 inventory creation).
// Phase_12_Full_Execution mission — isolated test DB only.
// Covers:
//   BL-05: sanctioned inventory creation (authN/Z, 404/400/422, 201 shape,
//          duplicate 409, same-tx audit, adjust/reserve/release afterwards,
//          zero-balance legality, inactive-variant refusal);
//   BL-01: true before/after on products/variants/categories/brands +
//          inventory threshold/reserve/release, correlation id + reason in
//          the payload, absence of phantom keys, no audit row on 404;
//   tamper: audit_logs UPDATE/DELETE/TRUNCATE rejected at the DB level.
// Prints JSON (never passwords, hashes, tokens, or connection strings).
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
  console.log(JSON.stringify({ suite: "wave1-audit-inventory", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

  const get = async (path, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
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
    const setCookie = r.headers.get("set-cookie") || "";
    const ck = extractSessionCookie(setCookie);
    return { status: r.status, cookie: ck ? ck.header : null };
  };
  const lastAudit = async (action, entityId) =>
    (
      await q(
        `SELECT old_values, new_values, user_id, entity_id FROM audit_logs
          WHERE action = $1 AND ($2::uuid IS NULL OR entity_id = $2::uuid)
          ORDER BY created_at DESC LIMIT 1`,
        [action, entityId ?? null],
      )
    )[0] ?? null;
  const auditCount = async (action, entityId) =>
    Number(
      (
        await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2::uuid`, [action, entityId])
      )[0].n,
    );

  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const createdIds = { categories: [], brands: [], products: [], variants: [], inventory: [], movements: [] };
  const track = (kind, id) => { if (isUuid(id)) createdIds[kind].push(id); };

  try {
    // ---------- authN/Z ----------
    const anon = await post("/api/admin/inventory/initialize", { productVariantId: crypto.randomUUID(), quantity: "1" });
    t("bl05-anon-401", anon.status === 401 && anon.body.error?.code === "UNAUTHENTICATED");

    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-ok", owner.status === 201 && !!owner.cookie);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    t("store-login-ok", store.status === 201 && !!store.cookie);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("bare-login-ok", bare.status === 201 && !!bare.cookie);
    const bareInit = await post("/api/admin/inventory/initialize", { productVariantId: crypto.randomUUID(), quantity: "1" }, bare.cookie);
    t("bl05-roleless-403", bareInit.status === 403 && bareInit.body.error?.code === "FORBIDDEN");

    // ---------- BL-05 validation ----------
    const unknown = await post("/api/admin/inventory/initialize", { productVariantId: crypto.randomUUID(), quantity: "1" }, owner.cookie);
    t("bl05-unknown-variant-404", unknown.status === 404 && unknown.body.error?.code === "NOT_FOUND");
    const negQty = await post("/api/admin/inventory/initialize", { productVariantId: crypto.randomUUID(), quantity: "-5" }, owner.cookie);
    t("bl05-negative-400", negQty.status === 400 && negQty.body.error?.code === "VALIDATION");
    const deepQty = await post("/api/admin/inventory/initialize", { productVariantId: crypto.randomUUID(), quantity: "1.2345" }, owner.cookie);
    t("bl05-four-decimals-400", deepQty.status === 400);
    const badQty = await post("/api/admin/inventory/initialize", { productVariantId: crypto.randomUUID(), quantity: "abc" }, owner.cookie);
    t("bl05-nonnumeric-400", badQty.status === 400);

    // ---------- fixture host + creation target ----------
    const prods = await get("/api/store/catalog/products?limit=20");
    const romi = prods.body.data?.find((p) => p.slug === "romi-cheese");
    t("fixture-romi-present", !!romi);
    const freshVariantName = `BL05 ${Date.now().toString(36)}`;
    const freshVar = await post(`/api/admin/catalog/products/${romi.id}/variants`, { name: freshVariantName, price: "47.35" }, owner.cookie);
    t("bl05-target-variant-created", freshVar.status === 201 && isUuid(freshVar.body.data?.id));
    const variantId = freshVar.body.data.id;
    track("variants", variantId);

    // ---------- BL-05 creation + audit ----------
    const CORR = `w1-${Date.now().toString(36)}`;
    const init = await post(
      "/api/admin/inventory/initialize",
      { productVariantId: variantId, quantity: "12.500", lowStockThreshold: "5.000", reason: "BL-05 sanctioned creation" },
      owner.cookie,
      { "x-correlation-id": CORR },
    );
    t("bl05-create-201", init.status === 201 && init.body.data?.inventory?.productVariantId === variantId, JSON.stringify(init.body).slice(0, 200));
    t("bl05-create-available", init.status === 201 && Number(init.body.data?.inventory?.availableQuantity) === 12.5);
    t("bl05-create-reserved-zero", init.status === 201 && Number(init.body.data?.inventory?.reservedQuantity) === 0);
    const invId = init.body.data?.inventoryId;
    track("inventory", invId);
    const createAudit = await lastAudit("inventory.create", invId);
    t("bl05-audit-row", !!createAudit);
    t("bl05-audit-old-null", createAudit?.old_values === null);
    t("bl05-audit-new-quantity", createAudit?.new_values?.quantity === "12.500");
    t("bl05-audit-reason", createAudit?.new_values?.reason === "BL-05 sanctioned creation");
    t("bl05-audit-correlation", createAudit?.new_values?.correlation_id === CORR);
    t("bl05-audit-actor", createAudit?.user_id !== null);

    // ---------- duplicate ----------
    const dup = await post("/api/admin/inventory/initialize", { productVariantId: variantId, quantity: "1" }, owner.cookie);
    t("bl05-duplicate-409", dup.status === 409 && dup.body.error?.code === "CONFLICT");
    t("bl05-duplicate-no-extra-audit", (await auditCount("inventory.create", invId)) === 1);

    // ---------- adjust / reserve / release with true before/after ----------
    const adj = await post("/api/admin/inventory/adjust", { productVariantId: variantId, delta: "2.500", movementType: "STOCK_IN", reason: "wave1 stock-in" }, owner.cookie);
    t("bl05-adjust-201", adj.status === 201 && Number(adj.body.data?.newQuantity) === 15);
    track("movements", adj.body.data?.movementId);
    const adjAudit = await lastAudit("inventory.adjust", invId);
    t("bl01-adjust-old-true", adjAudit?.old_values?.quantity === "12.500");
    t("bl01-adjust-new-true", adjAudit?.new_values?.quantity === "15.000");

    const res = await post("/api/admin/inventory/reserve", { productVariantId: variantId, quantity: "0.25" }, owner.cookie);
    t("bl05-reserve-201", res.status === 201, JSON.stringify(res.body).slice(0, 200));
    const resAudit = await lastAudit("inventory.reserve", invId);
    t("bl01-reserve-old-true", resAudit?.old_values?.reserved_quantity === "0.000");
    t("bl01-reserve-new-true", resAudit?.new_values?.reserved_quantity === "0.250" && resAudit?.new_values?.quantity === "0.25");

    const rel = await post("/api/admin/inventory/release", { productVariantId: variantId, quantity: "0.125" }, owner.cookie);
    t("bl05-release-201", rel.status === 201);
    const relAudit = await lastAudit("inventory.release", invId);
    t("bl01-release-old-true", relAudit?.old_values?.reserved_quantity === "0.250");
    t("bl01-release-new-true", relAudit?.new_values?.reserved_quantity === "0.125");

    const thr = await patch(`/api/admin/inventory/${variantId}`, { lowStockThreshold: null }, owner.cookie);
    t("bl05-threshold-clear-200", thr.status === 200 && thr.body.data?.lowStockThreshold === null);
    const thrAudit = await lastAudit("inventory.threshold", invId);
    t("bl01-threshold-old-true", thrAudit?.old_values?.lowStockThreshold === "5");
    t("bl01-threshold-new-null", thrAudit?.new_values?.lowStockThreshold === null);

    // ---------- BL-05 refusals ----------
    const deadProd = await post("/api/admin/catalog/products", { name: `BL05 dead ${Date.now().toString(36)}`, categoryId: (await q(`SELECT id FROM categories LIMIT 1`))[0].id, productType: "PIECE", unit: "PIECE", isActive: false }, owner.cookie);
    track("products", deadProd.body.data?.id);
    const deadVar = await post(`/api/admin/catalog/products/${deadProd.body.data.id}/variants`, { name: "dead v", price: "1.00" }, owner.cookie);
    track("variants", deadVar.body.data?.id);
    const deadInit = await post("/api/admin/inventory/initialize", { productVariantId: deadVar.body.data.id, quantity: "1" }, owner.cookie);
    t("bl05-inactive-variant-422", deadInit.status === 422 && deadInit.body.error?.code === "BUSINESS_RULE");

    // zero balance is a LEGAL declared balance
    const zeroVar = await post(`/api/admin/catalog/products/${romi.id}/variants`, { name: `BL05 zero ${Date.now().toString(36)}`, price: "1.00" }, owner.cookie);
    track("variants", zeroVar.body.data?.id);
    const zeroInit = await post("/api/admin/inventory/initialize", { productVariantId: zeroVar.body.data.id, quantity: "0", reason: "declared zero" }, owner.cookie);
    t("bl05-zero-balance-201", zeroInit.status === 201 && Number(zeroInit.body.data?.inventory?.availableQuantity) === 0);
    track("inventory", zeroInit.body.data?.inventoryId);

    // ---------- BL-01 diff on catalog PATCH paths ----------
    const catName = `W1 Cat ${Date.now().toString(36)}`;
    const cat = await post("/api/admin/catalog/categories", { name: catName }, owner.cookie);
    track("categories", cat.body.data?.id);
    const cat2 = await patch(`/api/admin/catalog/categories/${cat.body.data.id}`, { name: `${catName} B` }, owner.cookie);
    t("bl01-category-patch-200", cat2.status === 200);
    const catAudit = await lastAudit("categories.update", cat.body.data.id);
    t("bl01-category-old-true", catAudit?.old_values?.name === catName);
    t("bl01-category-new-true", catAudit?.new_values?.name === `${catName} B`);
    t("bl01-no-phantom-keys", !("slug" in (catAudit?.old_values ?? {})));

    const noCorr = await patch(`/api/admin/catalog/categories/${cat.body.data.id}`, { description: "d1" }, owner.cookie);
    t("bl01-no-header-patch-200", noCorr.status === 200);
    const noCorrAudit = await lastAudit("categories.update", cat.body.data.id);
    t("bl01-no-header-no-correlation", noCorrAudit?.new_values && noCorrAudit.new_values.correlation_id === undefined);
    t("bl01-no-header-diff-present", noCorrAudit?.old_values?.description === null && noCorrAudit?.new_values?.description === "d1");

    const brand = await post("/api/admin/catalog/brands", { name: `W1 Brand ${Date.now().toString(36)}` }, owner.cookie);
    track("brands", brand.body.data?.id);
    await patch(`/api/admin/catalog/brands/${brand.body.data.id}`, { name: `W1 Brand B` }, owner.cookie);
    const brandAudit = await lastAudit("brands.update", brand.body.data.id);
    t("bl01-brand-diff-true", brandAudit?.old_values?.name?.startsWith("W1 Brand") === true && brandAudit?.new_values?.name === "W1 Brand B");

    const prodName = `W1 Prod ${Date.now().toString(36)}`;
    const prod = await post("/api/admin/catalog/products", { name: prodName, categoryId: cat.body.data.id, productType: "PIECE", unit: "PIECE" }, owner.cookie);
    track("products", prod.body.data?.id);
    await patch(`/api/admin/catalog/products/${prod.body.data.id}`, { isActive: false }, owner.cookie);
    const prodAudit = await lastAudit("products.update", prod.body.data.id);
    t("bl01-product-old-true", prodAudit?.old_values?.isActive === true);
    t("bl01-product-new-true", prodAudit?.new_values?.isActive === false);

    const variantPatch = await patch(`/api/admin/catalog/variants/${variantId}`, { sizeValue: "0.500", sizeUnit: "KG" }, owner.cookie);
    t("bl01-variant-patch-200", variantPatch.status === 200);
    const varAudit = await lastAudit("variants.update", variantId);
    t("bl01-variant-old-null-size", varAudit?.old_values?.sizeValue === null);
    t("bl01-variant-new-size", varAudit?.new_values?.sizeValue === "0.5" && varAudit?.new_values?.sizeUnit === "KG");

    // 404 ⇒ business failure ⇒ NO audit row
    const before404 = Number((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'categories.update'`))[0].n);
    await patch("/api/admin/catalog/categories/02800000-0000-7000-8000-000000009999", { name: "ghost" }, owner.cookie);
    const after404 = Number((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'categories.update'`))[0].n);
    t("bl01-404-no-audit-row", before404 === after404);

    // ---------- tamper guard (DB level) ----------
    const probeTamper = async (label, sql) => {
      try {
        await db.query("BEGIN");
        await db.query(
          `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id) VALUES (NULL, 'SYSTEM', 'probe.w1', 'probe', NULL)`,
        );
        await db.query(sql);
        await db.query("ROLLBACK");
        t(label, false, "not blocked");
      } catch (e) {
        await db.query("ROLLBACK").catch(() => {});
        t(label, true, String(e.message).slice(0, 80));
      }
    };
    await probeTamper("tamper-update-blocked", `UPDATE audit_logs SET action = 'x.y' WHERE action = 'probe.w1'`);
    await probeTamper("tamper-delete-blocked", `DELETE FROM audit_logs WHERE action = 'probe.w1'`);
    try {
      await db.query("BEGIN");
      await db.query(`TRUNCATE audit_logs`);
      await db.query("ROLLBACK");
      t("tamper-truncate-blocked", false, "not blocked");
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      t("tamper-truncate-blocked", true, String(e.message).slice(0, 80));
    }
  } finally {
    // Hygiene: remove scratch-only rows (inventory → movements → codes →
    // variants → products → brands → categories; audit rows of deleted entities).
    try {
      for (const id of createdIds.movements) await db.query(`DELETE FROM inventory_movements WHERE id = $1`, [id]).catch(() => {});
      for (const id of createdIds.inventory) {
        await db.query(`DELETE FROM inventory WHERE id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM audit_logs WHERE action = 'inventory.create' AND entity_id = $1`, [id]).catch(() => {});
      }
      const variantIds = createdIds.variants;
      for (const id of variantIds) {
        await db.query(`DELETE FROM inventory WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM inventory_movements WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'inventory' AND entity_id IN (SELECT id FROM inventory WHERE product_variant_id = $1)`, [id]).catch(() => {});
        await db.query(`DELETE FROM product_price_history WHERE product_variant_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'product_variants' AND entity_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM product_variants WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of createdIds.products) {
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'products' AND entity_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM products WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of createdIds.brands) {
        await db.query(`DELETE FROM audit_logs WHERE entity_type = 'brands' AND entity_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM brands WHERE id = $1`, [id]).catch(() => {});
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
  console.error(`WAVE1_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
