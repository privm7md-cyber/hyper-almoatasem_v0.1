// Apply the 20261119_replacement_alternatives migration manually + record it
// in _prisma_migrations (the table exists but is empty — DB predates tracking).
// Safety: pre-write dump of the related tables (read-only), idempotent,
// transaction-scoped DDL.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { createHash as sha } from "node:crypto";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];

const MIGRATION_DIR = "prisma/migrations/20261119_replacement_alternatives/migration.sql";
const sql = readFileSync(MIGRATION_DIR, "utf8");
const checksum = sha("sha256").update(sql).digest("hex");

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Safety dump (pre-write evidence)
const dump = await c.query(`SELECT * FROM order_item_replacements ORDER BY created_at DESC LIMIT 20`);
writeFileSync("_recovery/v1-ops/evidence/repl-alternatives-migration-safety-dump.json", JSON.stringify({ table: "order_item_replacements", rows: dump.rows }, null, 2));
console.log("pre-write safety dump:", dump.rows.length, "rows of order_item_replacements");

const exists = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='order_item_replacement_alternatives'`);
if (exists.rows.length > 0) {
  console.log("table already exists — nothing to apply");
  await c.end();
  process.exit(0);
}

const { rowCount } = await c.query("BEGIN");
const r = await c.query(sql);
console.log("applied steps:", r.rowCount ?? 1);
const ins = await c.query(`
  INSERT INTO _prisma_migrations (id, checksum, started_at, finished_at, migration_name, applied_steps_count)
  VALUES (gen_random_uuid(), ${checksum}, now(), now(), '20261119_replacement_alternatives', ${sql.split(";").filter((s) => s.trim()).length})`,);
console.log("recorded migration:", ins.rows[0]?.migration_name ?? ins.rowCount);
await c.query("COMMIT");
await c.end();
console.log("APPLIED: 20261119_replacement_alternatives");
