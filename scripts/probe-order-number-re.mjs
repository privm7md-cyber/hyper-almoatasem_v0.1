// Dump orders chk_orders_number_format + order_items constraints (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid IN ('orders'::regclass, 'order_items'::regclass) AND contype='c' AND conname LIKE 'chk_orders_number%'`);
console.log(JSON.stringify(r.rows));
const r2 = await c.query(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='orders'::regclass AND contype='c' AND conname='chk_orders_number_format'`);
console.log(r2.rows.map((x) => x.d).join(""));
await c.end();
