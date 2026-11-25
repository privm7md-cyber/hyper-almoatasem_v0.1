// Dump order_items status transition CHECK + current chk_* (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='order_items'::regclass AND contype='c' AND (conname ILIKE '%status%' OR conname ILIKE '%transition%') ORDER BY conname`);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
