// second-agent-reset-fixture-holds.mjs — zeroes reserved_quantity for the four
// phase1 fixture variants on the isolated e2e DB (restores pre-suite baseline).
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
console.log("DB:", (await c.query("select current_database() db, current_user usr")).rows[0]);
const r = await c.query(`UPDATE inventory SET reserved_quantity = 0
  WHERE product_variant_id::text IN ('01800000-0000-7000-8000-000000000101','01800000-0000-7000-8000-000000000201','01800000-0000-7000-8000-000000000202','01800000-0000-7000-8000-000000000203')`);
console.log("rows updated:", r.rowCount);
const check = await c.query(`SELECT product_variant_id::text v, reserved_quantity::text r FROM inventory WHERE product_variant_id::text LIKE '018%' ORDER BY v`);
for (const row of check.rows) console.log(row.v.slice(-3), "reserved=" + row.r);
await c.end();
