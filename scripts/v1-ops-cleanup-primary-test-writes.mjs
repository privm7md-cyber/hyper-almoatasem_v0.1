// Cleanup accidental test writes on Primary from direct (pre-isolated-runner) checkout test runs.
// Removes ONLY: p0* products (+variants/codes/inventory explicitly), today's test carts.
// First prints what will be deleted; requires --execute to apply.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { PRIMARY_DATABASE, assertPrimaryCleanupConfirmation } from "./lib/disposable-db-guard.mjs";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (t, p) => (await db.query(t, p)).rows;
const execute = process.argv.includes("--execute");
if (execute) {
  const confirmation = process.argv.find((arg) => arg.startsWith("--confirm-primary="))?.split("=")[1] ?? null;
  assertPrimaryCleanupConfirmation(confirmation, { context: "v1-ops-cleanup-primary-test-writes" });
}
const identity = (await q("select current_database() as database")).at(0);
if (identity?.database !== PRIMARY_DATABASE) {
  console.error(`REFUSED_DB: expected ${PRIMARY_DATABASE}, got ${identity?.database}`);
  process.exit(1);
}
const products = await q(`SELECT id::text AS id, name FROM products WHERE name ILIKE 'p0a%' OR name ILIKE 'p0b%' OR name ILIKE 'p0c%' ORDER BY name`);
const variantIds = (await q(`SELECT v.id::text AS id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.name ILIKE 'p0a%' OR p.name ILIKE 'p0b%' OR p.name ILIKE 'p0c%' ORDER BY v.id`)).map((r) => r.id);
const productIds = products.map((p) => p.id);
const codes = await q(`SELECT id::text AS id FROM product_codes WHERE code LIKE 'p0-%' ORDER BY code`);
const carts = await q(`SELECT id::text AS id FROM carts WHERE created_at > '2026-11-19 06:00:00+00' AND session_id IS NOT NULL AND customer_id IS NULL ORDER BY created_at`);
console.log("products:", JSON.stringify(products));
console.log("variantIds:", JSON.stringify(variantIds), "codes:", JSON.stringify(codes.map((c) => c.id)), "carts:", JSON.stringify(carts));
if (!execute) { await db.end(); console.log("DRY RUN — pass --execute to delete"); process.exit(0); }
if (variantIds.length) {
  await db.query(`DELETE FROM cart_items WHERE product_variant_id = ANY($1::uuid[])`, [variantIds]);
  await db.query(`DELETE FROM inventory WHERE product_variant_id = ANY($1::uuid[])`, [variantIds]);
  await db.query(`DELETE FROM product_variants WHERE id = ANY($1::uuid[])`, [variantIds]);
}
if (codes.length) await db.query(`DELETE FROM product_codes WHERE id = ANY($1::uuid[])`, [[...codes.map((c) => c.id)]]);
if (productIds.length) await db.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [productIds]);
if (carts.length) {
  await db.query(`DELETE FROM cart_items WHERE cart_id = ANY($1::uuid[])`, [[...carts.map((c) => c.id)]]);
  await db.query(`DELETE FROM carts WHERE id = ANY($1::uuid[])`, [[...carts.map((c) => c.id)]]);
}
const after = {
  productsLeft: (await q(`SELECT count(*)::int AS n FROM products WHERE name ILIKE 'p0a%' OR name ILIKE 'p0b%' OR name ILIKE 'p0c%'`))[0].n,
  codesLeft: (await q(`SELECT count(*)::int AS n FROM product_codes WHERE code LIKE 'p0-%'`))[0].n,
  variantsLeft: variantIds.length,
  cartsToday: (await q(`SELECT count(*)::int AS n FROM carts WHERE created_at > '2026-11-19 06:00:00+00'`))[0].n,
  ordersToday: (await q(`SELECT count(*)::int AS n FROM orders WHERE created_at > '2026-11-19 06:00:00+00'`))[0].n,
  zones: (await q(`SELECT count(*)::int AS n FROM delivery_zones`))[0].n,
};
console.log("after:", JSON.stringify(after));
await db.end();
