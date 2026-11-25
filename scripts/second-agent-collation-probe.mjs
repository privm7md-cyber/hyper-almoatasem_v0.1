// second-agent-collation-probe.mjs — checks ar_eg collation + scale rows on e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const r3 = await c.query("SELECT collname FROM pg_collation WHERE collname LIKE 'ar%'");
console.log("ar collations:", JSON.stringify(r3.rows));
const r2 = await c.query("SELECT count(*)::int n FROM products WHERE slug LIKE 'bab-scale%'");
console.log("scale products:", r2.rows[0].n);
const r1 = await c.query("SELECT count(*)::int n FROM information_schema.collations WHERE collation_name = 'ar_eg'");
console.log("ar_eg info rows:", r1.rows[0].n);
await c.end();
