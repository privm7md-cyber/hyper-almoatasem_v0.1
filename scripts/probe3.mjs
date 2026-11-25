// Probe: _prisma_migrations presence + list applied migrations (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%migration%'");
console.log("migration tables:", JSON.stringify(r.rows.map((x) => x.table_name)));
const r2 = await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='_prisma_migrations'");
console.log("in _prisma_migrations:", JSON.stringify(r2.rows));
if (r2.rows[0]?.n > 0) {
  const r3 = await c.query("SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 8");
  console.log("recent migrations:", JSON.stringify(r3.rows.map((x) => x.migration_name)));
}
await c.end();
