// second-agent-inventory-full.mjs — full inventory rows for fixture variants.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='inventory' ORDER BY ordinal_position`);
console.log("inventory cols:", cols.rows.map(r => r.column_name).join(","));
const rows = await c.query(`SELECT * FROM inventory WHERE product_variant_id::text LIKE '018%'`);
for (const r of rows.rows) console.log(JSON.stringify(r));
const mv = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%movement%' OR tablename LIKE '%reservation%'`);
for (const r of mv.rows) console.log("TABLE", r.tablename);
await c.end();
