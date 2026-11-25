// Print FK cascade rules on Primary (read-only): product_variants.product_id, product_codes.product_variant_id, inventory.product_variant_id, carts.session_id.
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = (await db.query(`
  SELECT conrelid::regclass::text AS "table", conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE contype='f'
    AND (conrelid::regclass::text IN ('product_variants','product_codes','inventory','carts','order_items','order_lines'))
  ORDER BY table, conname`)).rows;
console.log(JSON.stringify(rows, null, 2));
await db.end();
