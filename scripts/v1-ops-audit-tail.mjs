// Read-only: inspect the newest audit_logs rows on Primary (which action, when, entity, actor type).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = await db.query("SELECT action, entity_type, entity_id::text AS entityId, user_id::text AS userId, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 12");
console.log(JSON.stringify(rows.rows, null, 2));
await db.end();
