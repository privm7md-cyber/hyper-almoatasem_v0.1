// second-agent-inventory-probe.mjs — checks reserved quantities for fixture variants.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const rows = await c.query(`SELECT product_variant_id::text AS v, reserved_quantity::text AS r, quantity::text AS q FROM inventory WHERE product_variant_id::text LIKE '01800000-0000-7000-8000%'`);
for (const r of rows.rows) console.log(r.v, "reserved=" + r.r, "quantity=" + r.q);
const pend = await c.query(`SELECT count(*)::int n FROM orders o WHERE o.status IN ('NEW','CONFIRMED','PREPARING','OUT_FOR_DELIVERY')`);
console.log("active orders:", pend.rows[0].n);
await c.end();
