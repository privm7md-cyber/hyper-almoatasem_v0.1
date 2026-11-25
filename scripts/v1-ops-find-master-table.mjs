// Dump table names containing 'master' or 'catalog' from Primary information_schema (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = await db.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%master%' OR table_name ILIKE '%catalog%' ORDER BY table_schema, table_name LIMIT 20");
console.log(JSON.stringify(rows.rows, null, 2));
await db.end();
