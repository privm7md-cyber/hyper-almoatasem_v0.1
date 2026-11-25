// second-agent-fixture-names.mjs — lists fixture product names on e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const r = await c.query(`SELECT id::text id, name, slug FROM products WHERE id::text LIKE '018%' OR slug LIKE '%pepsi%' OR name LIKE '%رومي%'`);
for (const row of r.rows) console.log(row.id.slice(-3), JSON.stringify(row.name), row.slug);
await c.end();
