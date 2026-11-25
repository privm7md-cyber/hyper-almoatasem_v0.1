// Debug scenario 5: check products named 'اسم مكرر تجريبي' on disposable.
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = (await db.query("SELECT id::text AS id, name, slug, created_at FROM products WHERE name = 'اسم مكرر تجريبي' OR name ILIKE '%متوازي%' OR name ILIKE '%سلعة موجودة%' LIMIT 30")).rows;
console.log(JSON.stringify(rows, null, 2));
await db.end();
