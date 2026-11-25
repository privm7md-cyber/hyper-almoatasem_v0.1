// Debug B2/B3: dump last replacements with reasons + orders/order_items rows.
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const rows = (await c.query(`
  SELECT r.id, r.status, r.reason, oi.id AS item_id, oi.item_status, o.order_number
  FROM order_item_replacements r
  JOIN order_items oi ON oi.id = r.order_item_id
  JOIN orders o ON o.id = oi.order_id
  ORDER BY r.created_at DESC LIMIT 6`)).rows;
console.log(JSON.stringify(rows, null, 2));
const items = (await c.query(`SELECT id::text, status, item_status, estimated_total FROM order_items ORDER BY created_at DESC LIMIT 6`)).rows;
console.log("items:", JSON.stringify(items));
await c.end();
