// Dump H2/privacy-related store_settings on Primary (read-only) — values for activation keys only.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = (await db.query("SELECT key, value_text, value_type FROM store_settings WHERE key ILIKE '%redact%' OR key ILIKE '%privacy%' OR key ILIKE '%v1_security%' ORDER BY key")).rows;
console.log(JSON.stringify(rows, null, 2));
await db.end();
