// Final brands verification (READ-ONLY on Primary): 59 brands inserted,
// no duplicates, products assigned, audit trail check.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const out = {};
const count = async (q, p) => (await c.query(q, p ?? [])).rows[0].n;
out.brandsTotal = await count("SELECT count(*)::int n FROM brands");
out.brandsActive = await count("SELECT count(*)::int n FROM brands WHERE is_active");
out.brandsDeleted = await count("SELECT count(*)::int n FROM brands WHERE deleted_at IS NOT NULL");
out.productsWithBrand = await count("SELECT count(*)::int n FROM products WHERE brand_id IS NOT NULL");
out.productsTotal = await count("SELECT count(*)::int n FROM products");
out.productsActive = await count("SELECT count(*)::int n FROM products WHERE is_active");
out.productsDeleted = await count("SELECT count(*)::int n FROM products WHERE deleted_at IS NOT NULL");
out.duplicateNames = (await c.query(`SELECT name, count(*)::int n FROM brands GROUP BY name HAVING count(*) > 1`)).rows;
out.duplicateSlugs = (await c.query(`SELECT slug, count(*)::int n FROM brands GROUP BY slug HAVING count(*) > 1`)).rows;
// newest brands
out.newest = (await c.query(`SELECT name, created_at FROM brands ORDER BY created_at DESC LIMIT 10`)).rows;
// brands created this session window (today after 13:00 UTC)
out.createdToday = await count("SELECT count(*)::int n FROM brands WHERE created_at > '2026-11-19 12:00:00+00'");
// audit trail checks
out.auditBrandCreates = await count("SELECT count(*)::int n FROM audit_logs WHERE action = 'brands.create'");
out.auditBrandUpdates = await count("SELECT count(*)::int n FROM audit_logs WHERE action IN ('brands.update','brands.activate','brands.deactivate')");
out.auditBrandAssigns = await count("SELECT count(*)::int n FROM audit_logs WHERE action IN ('products.brand_assign','products.update_brand')");
out.auditAll = (await c.query("SELECT action, count(*)::int n FROM audit_logs GROUP BY action ORDER BY action")).rows;
await c.end();
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OWNER_POLICY_UPDATE/PHASE_D_E_FINAL_CLOSURE/db-reconciliation.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
