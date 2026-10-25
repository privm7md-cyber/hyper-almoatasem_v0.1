// ============================================================================
// PRICE-BASIS REVIEW (read-only) — Phase 07 (D01 rule 9)
// ============================================================================
// Lists the catalog rows whose stored price does NOT match the sale model they
// are sold under, so the owner can correct the data independently:
//
//   - WEIGHT products whose variant unit is not KG: the contract prices a
//     WEIGHT line per its sale unit, and the storefront now shows a WEIGHT
//     price as a per-kilogram price (D01). Rows whose catalog value is a PACK
//     price (not a per-kg price) are reported here instead of being silently
//     reinterpreted. Until such a row is corrected, the storefront sells it as
//     a pack (no weight selection) so no financially wrong order line can be
//     created.
//
// Usage (read-only):
//   node --env-file=.env scripts/catalog/price-basis-review.mjs > review.csv
// ============================================================================
import "dotenv/config";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query(
    `SELECT p.id::text AS product_id, p.name AS product_name, p.product_type,
            p.unit AS product_unit, p.sale_step_grams,
            v.id::text AS variant_id, v.name AS variant_name,
            v.size_value, v.size_unit, v.price,
            (v.price::numeric * (COALESCE(v.size_value, 0)))::text AS pack_value_estimate
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE p.is_active AND p.deleted_at IS NULL
        AND v.is_active AND v.deleted_at IS NULL
        AND p.product_type = 'WEIGHT'
        AND (v.size_unit IS NULL OR v.size_unit <> 'KG')
      ORDER BY p.name`,
  );
  const out = [
    "product_id,product_name,product_type,product_unit,sale_step_grams,variant_id,variant_name,size_value,size_unit,price,issue",
  ];
  for (const r of rows) {
    const issue =
      r.size_unit === null
        ? "WEIGHT variant without a sale unit — the storefront cannot offer a weight sale (price basis undefined)"
        : "WEIGHT variant priced per pack while the sale model is per kilogram — needs an independent price correction";
    out.push(
      [
        r.product_id,
        `"${r.product_name}"`,
        r.product_type,
        r.product_unit,
        r.sale_step_grams ?? "",
        r.variant_id,
        `"${r.variant_name}"`,
        r.size_value ?? "",
        r.size_unit ?? "",
        r.price,
        `"${issue}"`,
      ].join(","),
    );
  }
  process.stdout.write(out.join("\n") + "\n");
  process.stderr.write(`affected_weight_rows=${rows.length}\n`);
} finally {
  await db.end();
}
