// third-agent-fixture-users.mjs — READ-ONLY listing of fixture user emails on the e2e DB.
import "dotenv/config";
import { Client } from "pg";
const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const idq = await c.query("select current_database() db, current_user usr");
console.log("IDENTITY", JSON.stringify(idq.rows[0]));
const r = await c.query("SELECT email, is_active, created_at::date d FROM users WHERE email LIKE '%example.com' ORDER BY email");
for (const row of r.rows) console.log(row.email, "active=" + row.is_active, row.d);
const tot = await c.query("SELECT count(*)::int n FROM users");
console.log("users-total", tot.rows[0].n);
await c.end();
