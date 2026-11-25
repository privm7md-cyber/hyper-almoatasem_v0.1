// second-agent-holds-probe.mjs — lists active orders and their holds on e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const ord = await c.query(`SELECT id::text id, order_number, status, created_at FROM orders WHERE status IN ('NEW','CONFIRMED','PREPARING','OUT_FOR_DELIVERY','PENDING') ORDER BY created_at DESC LIMIT 15`);
for (const o of ord.rows) console.log("ORDER", o.order_number, o.status, o.created_at, o.id);
await c.query(`SELECT status, decided_by_type, count(*)::int n FROM order_item_replacements GROUP BY 1,2 ORDER BY 1`);
const items = await c.query(`SELECT oi.order_id, oi.product_variant_id::text v, oi.requested_quantity::text q, oi.item_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status IN ('NEW','CONFIRMED','PREPARING','OUT_FOR_DELIVERY','PENDING') AND oi.product_variant_id::text LIKE '018%'`);
for (const i of items.rows) console.log("ITEM", i.v.slice(-3), "qty=" + i.q, i.item_status, i.order_id.slice(0, 8));
await c.end();
