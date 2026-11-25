// Final Primary DB inventory check (read-only SELECTs) — evidence/db-inventory-final.txt.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const tables = ["products", "product_variants", "product_codes", "inventory", "inventory_movements", "orders", "customers", "promotions", "promotions_coupons", "audit_logs", "users", "admin_sessions", "order_items", "delivery_zones", "categories"];
const out = { generatedAt: new Date().toISOString(), db: "hyper_almoatasem", readOnly: true, counts: {} };
for (const t of tables) {
  try { const r = await db.query(`SELECT count(*)::int AS n FROM ${t}`); out.counts[t] = r.rows[0].n; }
  catch { out.counts[t] = null; }
}
writeFileSync("_recovery/v1-ops/evidence/db-inventory-final.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
await db.end();
