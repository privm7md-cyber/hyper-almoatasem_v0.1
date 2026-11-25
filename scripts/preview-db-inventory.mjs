// Read-only inventory of a candidate preview database.
// Usage: node scripts/preview-db-inventory.mjs --db <name>
// Refuses any database that is not on the explicit scratch allowlist.
import "dotenv/config";
import { Client } from "pg";

const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_closure_20261030",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
  "hyper_almoatasem_restore_verify_20260924",
  "hyper_almoatasem_restore_verify_2_20260924",
];

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
if (dbFlag === -1 || !args[dbFlag + 1]) {
  console.error("USAGE: node scripts/preview-db-inventory.mjs --db <name>");
  process.exit(1);
}
const dbName = args[dbFlag + 1];
if (!ALLOWED_SCRATCH_DBS.includes(dbName)) {
  console.error(`REFUSED_NOT_A_SCRATCH_DATABASE: ${dbName}`);
  process.exit(1);
}

const url = new URL(process.env.MIGRATION_DATABASE_URL);
url.pathname = `/${dbName}`;
const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });

const TABLES = [
  "users", "roles", "permissions", "role_permissions", "user_roles",
  "products", "product_variants", "categories", "brands", "inventory",
  "customers", "orders", "order_items", "promotions", "coupons",
  "store_settings", "delivery_zones", "audit_logs", "admin_sessions",
];

try {
  await client.connect();
  const current = await client.query("select current_database() as db, current_user as usr");
  console.log(`connected: ${current.rows[0].db} as ${current.rows[0].usr}`);
  const out = {};
  for (const t of TABLES) {
    try {
      const r = await client.query(`select count(*)::bigint as n from ${t}`);
      out[t] = Number(r.rows[0].n);
    } catch {
      out[t] = "n/a";
    }
  }
  for (const [k, v] of Object.entries(out)) {
    console.log(`${k.padEnd(20)} ${v}`);
  }

  const admins = await client.query(
    `select u.email, u.name, u.is_active, array_remove(array_agg(r.name), null) as roles
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
      group by u.id, u.email, u.name, u.is_active
      order by u.email
      limit 25`,
  );
  console.log("\naccounts:");
  for (const a of admins.rows) {
    console.log(`  ${a.email}  active=${a.is_active}  roles=[${(a.roles || []).join(", ")}]`);
  }
  await client.end();
} catch (e) {
  console.error("ERR", e.message);
  process.exit(1);
}
