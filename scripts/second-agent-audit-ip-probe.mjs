// second-agent-audit-ip-probe.mjs — checks audit login_failure IP rows on e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const r = await c.query(`SELECT created_at, ip_address, count(*)::int n FROM audit_logs WHERE action = 'auth.login_failure' GROUP BY 1,2 ORDER BY 1 DESC LIMIT 20`);
for (const row of r.rows) console.log(row.created_at, row.ip_address, "n=" + row.n);
await c.end();
