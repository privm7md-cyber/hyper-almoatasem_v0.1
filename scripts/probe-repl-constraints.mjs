// Probe: live constraints on order_item_replacements.status + callers of proposeReplacement/decideReplacement (read-only).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='order_item_replacements'::regclass AND contype='c' AND (conname LIKE '%status%' OR conname LIKE '%uq%') LIMIT 8`,
);
console.log(JSON.stringify(r.rows, null, 2));
const uq = await c.query(
  `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='order_item_replacements' ORDER BY 1 LIMIT 12`,
);
console.log(JSON.stringify(uq.rows.map((x) => x.indexname), null, 2));
await c.end();
