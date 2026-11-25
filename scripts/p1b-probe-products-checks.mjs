// Dump products check constraints (Primary, read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const r = await db.query("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='products'::regclass AND contype='c' ORDER BY conname");
console.log(r.rows);
await db.end();
