// Inspect accidental test writes on Primary (p0-*, carts, zones) — read-only.
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (t) => (await db.query(t)).rows;
console.log("p0 products:", JSON.stringify(await q(`SELECT id::text AS id, name, slug FROM products WHERE name ILIKE 'p0a%' OR name ILIKE 'p0b%' OR name ILIKE 'p0c%' OR name ILIKE 'v-a-%' OR name ILIKE 'v-b-%' OR name ILIKE 'v-c-%'`)));
console.log("p0 codes:", JSON.stringify(await q(`SELECT code, type FROM product_codes WHERE code LIKE 'p0-%' ORDER BY code`)));
console.log("p0 variants:", JSON.stringify(await q(`SELECT v.id::text AS id, v.name FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.name ILIKE 'p0a%' OR p.name ILIKE 'p0b%' OR p.name ILIKE 'p0c%'`)));
console.log("zones on Primary:", JSON.stringify(await q(`SELECT id::text AS id, name FROM delivery_zones`)));
console.log("carts today (created after 2026-11-19 06:00Z):", (await q(`SELECT count(*)::int AS n FROM carts WHERE created_at > '2026-11-19 06:00:00+00'`)).length ? JSON.stringify(await q(`SELECT count(*)::int AS n FROM carts WHERE created_at > '2026-11-19 06:00:00+00'`)) : "0");
await db.end();
