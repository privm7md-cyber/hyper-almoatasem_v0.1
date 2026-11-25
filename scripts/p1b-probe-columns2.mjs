// Dump actual DB columns of products/product_variants/categories/product_images (Primary, read-only).
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const out = {};
for (const t of ["products", "product_variants", "categories", "product_images"]) {
  const r = await db.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position", [t]);
  out[t] = r.rows.map((c) => c.column_name + (c.is_nullable === "YES" ? "" : " NOT NULL") + (c.column_default ? " def" : ""));
}
writeFileSync("_recovery/v1-ops/evidence/db-columns.json", JSON.stringify(out, null, 2));
for (const [t, cols] of Object.entries(out)) console.log(t + ":", cols.join(", "));
await db.end();
