// Probe: describe _prisma_migrations shape (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='_prisma_migrations' ORDER BY ordinal_position`);
console.log(JSON.stringify(r.rows));
await c.end();
