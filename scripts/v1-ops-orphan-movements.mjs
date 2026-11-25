// Read-only: the 2 orphan movements (reference_id without a matching inventory.import audit).
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = await db.query(`
  SELECT m.id::text AS movementId, m.product_variant_id::text AS variantId, m.movement_type, m.quantity::text AS quantity,
         m.previous_quantity::text AS previous_quantity, m.new_quantity::text AS new_quantity,
         m.reference_type, m.reference_id::text AS referenceId, m.reason, m.created_at
  FROM inventory_movements m
  WHERE m.reference_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action='inventory.import' AND a.entity_id::text = m.reference_id::text)
  ORDER BY m.created_at LIMIT 5`);
console.log(JSON.stringify(rows.rows, null, 2));
await db.end();
