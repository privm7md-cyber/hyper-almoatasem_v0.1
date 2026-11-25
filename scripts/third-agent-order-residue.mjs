// third-agent-order-residue.mjs — READ-ONLY: are there orders older than
// "yesterday" in the e2e DB? Explains t-baf-admin date-to-past-empty.
import "dotenv/config";
import { Client } from "pg";
const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const idq = await c.query("select current_database() db, current_user usr");
console.log("IDENTITY", JSON.stringify(idq.rows[0]));
const yesterday = new Date(Date.now() - 86400_000).toISOString();
const r = await c.query("SELECT count(*)::int n FROM orders WHERE created_at < $1", [yesterday]);
console.log("orders older than yesterday:", r.rows[0].n);
const mx = await c.query("SELECT max(created_at)::text mx, min(created_at)::text mn FROM orders");
console.log("order created_at range:", JSON.stringify(mx.rows[0]));
const tot = await c.query("SELECT count(*)::int n FROM orders");
console.log("orders total:", tot.rows[0].n);
await c.end();
