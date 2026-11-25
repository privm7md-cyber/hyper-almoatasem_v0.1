// second-agent-holds2.mjs — inventory movements for P1L.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='inventory_movements' ORDER BY ordinal_position`);
console.log("mov cols:", cols.rows.map(r => r.column_name).join(","));
const rows = await c.query(`SELECT * FROM inventory_movements WHERE product_variant_id='01800000-0000-7000-8000-000000000202' ORDER BY created_at DESC LIMIT 12`);
for (const r of rows.rows) console.log(JSON.stringify(r).slice(0, 400));
await c.end();
