// Dump inventory check constraints (read-only) + inventory columns.
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='inventory'::regclass AND contype='c' ORDER BY conname`);
console.log(JSON.stringify(r.rows, null, 2));
const r2 = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='inventory' ORDER BY ordinal_position`);
console.log(JSON.stringify(r2.rows));
await c.end();
