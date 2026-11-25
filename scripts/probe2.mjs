// Probe live UQ definition + replacement table columns (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("SELECT indexdef FROM pg_indexes WHERE tablename='order_item_replacements' AND indexname='uq_replacements_one_proposed'");
console.log("UQ:", r.rows[0]?.indexdef ?? "none");
const r2 = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='order_item_replacements' ORDER BY ordinal_position");
console.log(r2.rows.map((x) => x.column_name + ":" + x.data_type).join(" | "));
await c.end();
