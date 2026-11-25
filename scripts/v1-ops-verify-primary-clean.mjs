// Verify Primary test-write cleanup (read-only): no p0-* codes/products/carts/zones; count stray p0 variants.
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = async (t) => (await db.query(t)).rows;
console.log(JSON.stringify({
  products: (await q(`SELECT count(*)::int AS n FROM products WHERE name ILIKE 'p0a%' OR name ILIKE 'p0b%' OR name ILIKE 'p0c%'`))[0].n,
  variants: (await q(`SELECT count(*)::int AS n FROM product_variants v LEFT JOIN products p ON p.id=v.product_id WHERE p.name ILIKE 'p0a%' OR p.name ILIKE 'p0b%' OR p.name ILIKE 'p0c%'`))[0].n,
  codes: (await q(`SELECT count(*)::int AS n FROM product_codes WHERE code LIKE 'p0-%'`))[0].n,
  carts: (await q(`SELECT count(*)::int AS n FROM carts WHERE created_at > '2026-11-19 06:00:00+00' AND session_id IS NOT NULL AND customer_id IS NULL`))[0].n,
  zones: (await q(`SELECT count(*)::int AS n FROM delivery_zones`))[0].n,
  totalProducts: (await q(`SELECT count(*)::int AS n FROM products`))[0].n,
}, null, 2));
await db.end();
