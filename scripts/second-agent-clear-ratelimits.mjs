// second-agent-clear-ratelimits.mjs — clears rate-limit rows on the isolated e2e DB only.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
console.log("DB:", (await c.query("select current_database() db, current_user usr")).rows[0]);
for (const tbl of ["admin_auth_rate_limits", "guest_order_rate_limits", "customer_register_rate_limits", "api_rate_limits", "customer_auth_rate_limits"]) {
  try {
    const r = await c.query(`SELECT count(*)::int n FROM public."${tbl}"`);
    await c.query(`DELETE FROM public."${tbl}"`);
    console.log(tbl, "cleared rows=" + r.rows[0].n);
  } catch (e) { console.log(tbl, "SKIP " + e.message.slice(0, 80)); }
}
await c.end();
