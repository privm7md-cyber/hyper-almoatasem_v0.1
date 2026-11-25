// second-agent-e2e-identity.mjs — READ-ONLY identity probe of the isolated e2e DB.
// Builds the connection string from .env's MIGRATION_DATABASE_URL (read-only)
// but swaps the pathname to the e2e DB; the URL is never printed. No writes.
import "dotenv/config";
import { Client } from "pg";

const base = new URL(process.env.MIGRATION_DATABASE_URL);
base.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: base.toString() });
await c.connect();
const me = (await c.query("select current_database() db, current_user usr")).rows[0];
const t = (await c.query("select count(*)::int n from information_schema.tables where table_schema = 'public'")).rows[0];
let products = null;
let checks = null;
try {
  products = (await c.query("select count(*)::int n from products")).rows[0];
  checks = (await c.query("select count(*)::int n from information_schema.table_constraints where constraint_schema = 'public' and constraint_type = 'CHECK'")).rows[0];
} catch (e) {
  console.log("query-note:", e.message);
}
console.log("E2E:", JSON.stringify(me), "publicTables=" + t.n, "products=" + (products ? products.n : "n/a"), "checks=" + (checks ? checks.n : "n/a"));
await c.end();