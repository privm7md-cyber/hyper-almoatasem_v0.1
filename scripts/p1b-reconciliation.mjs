// P1-B — read-only catalog reconciliation against PRIMARY (hyper_almoatasem), via pg.Client.
// Evidence: _recovery/v1-ops/evidence/reconciliation.json.
// - A. category counts: direct active products vs active descendant-tree counts + catalog totals
// - B. classification risks: PIECE packages with GRAM/KG labels; WEIGHT products with non-KG/GRAM units
// - C. variant metadata gaps: size_unit / size_value missing (active variants)
// - D. products without images (product_images)
// - E. archived/hidden products (CatalogCounts semantics)
// - F. price-source conflicts: compare_at_price vs price
// Read-only: only SELECTs.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
async function q(text, params = []) { const r = await db.query(text, params); return r.rows; }
const out = { generatedAt: new Date().toISOString(), db: "hyper_almoatasem", readOnly: true, queries: [] };
out.queries.push(["A", "categories direct/tree"]);

// ---- A. category counts ------------------------------------------------------
const cats = await q(`SELECT id::text AS id, name, parent_id AS parentId, is_active FROM categories`);
const directRows = await q(`
  SELECT c.id::text AS id, count(*)::int AS n FROM categories c
  LEFT JOIN products p ON p.category_id = c.id AND p.is_active AND p.deleted_at IS NULL
  GROUP BY c.id`);
const direct = new Map(directRows.map((r) => [r.id, r.n]));
function treeCount(id) {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) { const cur = stack.pop();
    for (const c of cats) if (c.parentId === cur) { if (!seen.has(c.id)) { seen.add(c.id); stack.push(c.id); } } }
  let n = 0;
  for (const k of seen) n += direct.get(k) ?? 0;
  return n;
}
out.A_categoryCounts = cats.map((c) => {
  const directCount = direct.get(c.id) ?? 0;
  const tree = treeCount(c.id);
  return { id: c.id, name: c.name, isActive: c.is_active, direct: directCount, tree, directMinusTree: directCount - tree };
});
out.A_diffs = out.A_categoryCounts.filter((c) => c.direct !== c.tree);
out.A_catalogCounts = (await q(`
  SELECT
    (SELECT count(*)::int FROM products WHERE is_active AND deleted_at IS NULL) AS displayed,
    (SELECT count(*)::int FROM products WHERE NOT is_active AND deleted_at IS NULL) AS hidden,
    (SELECT count(*)::int FROM products WHERE deleted_at IS NOT NULL) AS archived,
    (SELECT count(*)::int FROM products) AS total,
    (SELECT count(*)::int FROM product_variants WHERE deleted_at IS NULL) AS variantsTotal,
    (SELECT count(*)::int FROM product_variants) AS variantsAny`))[0];

// ---- B. classification risks -------------------------------------------------
out.B_pieceWithWeightLabels = await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, v.size_unit, v.size_value
  FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE p.product_type = 'PIECE' AND p.is_active AND p.deleted_at IS NULL
    AND v.size_unit IN ('KG','GRAM') AND v.deleted_at IS NULL`);
out.B_weightWithNonKgUnits = await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, p.product_type, v.size_unit, v.size_value
  FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE p.product_type = 'WEIGHT' AND p.is_active AND p.deleted_at IS NULL
    AND v.size_unit IS DISTINCT FROM 'KG' AND v.size_unit IS DISTINCT FROM 'GRAM' AND v.deleted_at IS NULL`);

// ---- C. missing variant metadata --------------------------------------------
out.C_counts = {
  activeVariants: (await q(`SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.is_active AND p.deleted_at IS NULL AND v.deleted_at IS NULL`))[0].n,
  missingSizeUnit: (await q(`SELECT count(*)::int AS n FROM product_variants WHERE size_unit IS NULL`))[0].n,
  missingSizeValue: (await q(`SELECT count(*)::int AS n FROM product_variants WHERE size_value IS NULL`))[0].n,
  missingSizeUnit_active: (await q(`SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.size_unit IS NULL AND p.is_active AND p.deleted_at IS NULL`))[0].n,
  missingSizeValue_active: (await q(`SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.size_value IS NULL AND p.is_active AND p.deleted_at IS NULL`))[0].n,
};

// ---- D. products without images ---------------------------------------------
out.D_productsWithoutImages_count = (await q(`
  SELECT count(*)::int AS n FROM products p
  WHERE p.is_active AND p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)`))[0].n;
out.D_productsWithoutImages = await q(`
  SELECT p.id::text AS productId, p.name FROM products p
  WHERE p.is_active AND p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id) LIMIT 50`);

// ---- E. archived/hidden ------------------------------------------------------
out.E = out.A_catalogCounts;

// ---- F. price-source conflicts ---------------------------------------------
out.F_variantsWithCompareAt = await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName,
         v.price::text AS price, v.compare_at_price::text AS compareAt, v.cost_price::text AS cost
  FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE v.compare_at_price IS NOT NULL`);
out.F_compareAtBelowPrice = (await q(`
  SELECT count(*)::int AS n FROM product_variants v
  WHERE v.compare_at_price IS NOT NULL AND v.price IS NOT NULL AND v.compare_at_price < v.price`))[0].n;
out.F_costVsPrice = await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName,
         v.price::text AS price, v.cost_price::text AS cost
  FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE v.cost_price IS NOT NULL AND (v.price - v.cost_price) < 0`);

await db.end();
writeFileSync("_recovery/v1-ops/evidence/reconciliation.json", JSON.stringify(out, null, 2) + "\n");
console.log("Wrote _recovery/v1-ops/evidence/reconciliation.json");
