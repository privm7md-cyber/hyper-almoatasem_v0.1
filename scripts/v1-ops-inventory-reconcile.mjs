// V1 Real Data Onboarding — Inventory reconciliation on PRIMARY (read-only).
// Produces evidence/inventory-reconciliation.json:
//   products/variants state; inventory quantities (zero/positive/negative/unknown);
//   repeated imports (distinct import ids, replay-ready imports); audit records by action;
//   movement/audit pairing; orphan movements check.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (t) => db.query(t);
const out = { generatedAt: new Date().toISOString(), db: "hyper_almoatasem", readOnly: true, sections: {} };

const prodTotals = (await q(`
  SELECT (SELECT count(*)::int FROM products) n,
         (SELECT count(*)::int FROM products WHERE is_active) n_active,
         (SELECT count(*)::int FROM products WHERE NOT is_active) n_hidden,
         (SELECT count(*)::int FROM products WHERE deleted_at IS NOT NULL) n_archived`)).rows[0];
out.sections.products = { n: prodTotals.n, active: prodTotals.n_active, hidden: prodTotals.n_hidden - prodTotals.n_archived, archived: prodTotals.n_archived, displayed: prodTotals.n_active - prodTotals.n_archived };

const variantTotals = (await q(`SELECT count(*)::int n, count(*) FILTER (WHERE is_active) n_active, count(*) FILTER (WHERE deleted_at IS NOT NULL) n_deleted FROM product_variants`)).rows[0];
out.sections.variants = variantTotals;

const inv = (await q(`
  SELECT (SELECT count(*)::int FROM inventory) n,
         (SELECT count(*)::int FROM inventory WHERE quantity > 0) n_pos,
         (SELECT count(*)::int FROM inventory WHERE quantity = 0) n_zero,
         (SELECT count(*)::int FROM inventory WHERE quantity < 0) n_neg`)).rows[0];
out.sections.inventory = inv;

const unknownProducts = (await q(`
  SELECT count(*)::int n FROM products p WHERE p.is_active AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_variant_id = ANY(SELECT v.id FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.deleted_at IS NULL))`)).rows[0];
out.sections.inventory_unknown_stock = unknownProducts;

const negVariants = (await q(`
  SELECT p.id::text productId, p.name productName, v.id::text variantId, v.quantity::text quantity, v.updated_at::text updatedAt
  FROM inventory v JOIN product_variants pv ON pv.id = v.product_variant_id JOIN products p ON p.id = pv.product_id
  WHERE v.quantity < 0 ORDER BY v.quantity LIMIT 20`)).rows;
out.sections.negative_stock_sample = negVariants;

// Repeated imports: distinct importIds, per-import audit + movement counts
const importStats = (await q(`
  SELECT count(*)::int n_import_audits, count(DISTINCT entity_id::text) AS n_distinct_import_ids,
         (SELECT count(*)::int FROM audit_logs WHERE action='inventory.import_row') AS n_import_rows
  FROM audit_logs WHERE action='inventory.import'`)).rows[0];
out.sections.repeated_imports = importStats;
const movementStats = (await q(`
  SELECT count(*)::int n_movements, count(DISTINCT reference_id::text) n_distinct_import_ids
  FROM inventory_movements WHERE reference_type='ADJUSTMENT' AND reference_id IS NOT NULL`)).rows[0];
out.sections.inventory_movements = movementStats;
const orphanMovements = (await q(`SELECT count(*)::int n FROM inventory_movements m WHERE reference_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action='inventory.import' AND a.entity_id::text = m.reference_id::text)`)).rows[0];
out.sections.orphan_movements = orphanMovements;

// Audit records by action
const auditByAction = (await q(`SELECT action, count(*)::int n FROM audit_logs GROUP BY action ORDER BY action`)).rows;
out.sections.audit_records = { total: (await q(`SELECT count(*)::int n FROM audit_logs`)).rows[0].n, by_action: Object.fromEntries(auditByAction.map((r) => [r.action, r.n])), writers: (await q(`SELECT count(*)::int n FROM audit_logs WHERE user_id IS NOT NULL`)).rows[0].n };

// Partial failure check: import rows without matching inventory movements when adjusted
const partialAdjustments = (await q(`
  SELECT count(*)::int n FROM audit_logs al
  WHERE al.action='inventory.import_row' AND al.new_values->>'quantity' IS NOT NULL AND (al.new_values->>'quantity')::numeric <> 0::numeric
    AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.reference_id = al.entity_id::text)`)).rows[0];
out.sections.partial_failure_suspects = partialAdjustments;

writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OPERATIONS_CLOSURE/Run_20261119_0630/evidence/inventory-reconciliation.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote _recovery/v1-ops/evidence/inventory-reconciliation.json");
await db.end();
