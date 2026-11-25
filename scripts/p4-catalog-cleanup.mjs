// V1 Real Data Onboarding — P4 catalog cleanup: variant/unit metadata gaps with confidence
// levels, packaged-product classification review, category count discrepancies, image coverage.
// Primary DB — SELECTs only. Produces evidence/p4-catalog-cleanup.json.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (t) => db.query(t);
const out = { generatedAt: new Date().toISOString(), db: "hyper_almoatasem", readOnly: true, sections: {} };

// ---- A. Category count discrepancies: direct vs active descendant-tree -----------------
const cats = (await q(`SELECT id::text AS id, name, parent_id AS parentId FROM categories`)).rows;
const direct = new Map((await q(`SELECT c.id::text AS id, count(*)::int AS n FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.is_active AND p.deleted_at IS NULL GROUP BY c.id`)).rows.map((r) => [r.id, r.n]));
function treeCount(id) {
  const seen = new Set([id]); const stack = [id];
  while (stack.length) { const cur = stack.pop();
    for (const c of cats) if (c.parentId === cur) { if (!seen.has(c.id)) { seen.add(c.id); stack.push(c.id); } } }
  let n = 0;
  for (const k of seen) n += direct.get(k) ?? 0;
  return n;
}
out.sections.A_category_count_diffs = cats.map((c) => ({ id: c.id, name: c.name, direct: direct.get(c.id) ?? 0, tree: treeCount(c.id), diff: (direct.get(c.id) ?? 0) - treeCount(c.id) }));

// ---- B. Variant metadata gaps with confidence -------------------------------------------
const WEIGHT_WORDS = /(جرام|كيلو|كجم|gram|kg|ميج|lb|ميل|ounce|وزن|weight)/i;
out.sections.B_missing_size_unit_active = (await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, p.product_type, v.size_value,
         CASE WHEN p.name ~* 'جرام|كيلو|كجم|gram|kg|وزن|weight' THEN 'MEDIUM' ELSE 'LOW' END AS confidence
  FROM product_variants v JOIN products p ON p.id=v.product_id
  WHERE v.size_unit IS NULL AND v.deleted_at IS NULL AND p.is_active AND p.deleted_at IS NULL`)).rows;
out.sections.B_missing_size_value_active = (await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, p.product_type, v.size_unit
  FROM product_variants v JOIN products p ON p.id=v.product_id
  WHERE v.size_value IS NULL AND v.deleted_at IS NULL AND p.is_active AND p.deleted_at IS NULL`)).rows;
out.sections.B_packaged_grams_PIECE = (await q(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, v.size_unit, v.size_value
  FROM product_variants v JOIN products p ON p.id=v.product_id
  WHERE p.product_type='PIECE' AND p.is_active AND p.deleted_at IS NULL
    AND v.size_unit IN ('KG','GRAM') AND v.deleted_at IS NULL`)).rows;
out.sections.counts = {
  missing_size_unit_active: (await q(`SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.size_unit IS NULL AND v.deleted_at IS NULL AND p.is_active AND p.deleted_at IS NULL`)).rows[0].n,
  missing_size_unit_all: (await q(`SELECT count(*)::int AS n FROM product_variants WHERE size_unit IS NULL`)).rows[0].n,
  missing_size_value_active: (await q(`SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.size_value IS NULL AND v.deleted_at IS NULL AND p.is_active AND p.deleted_at IS NULL`)).rows[0].n,
  packaged_grams_piece_count: (await q(`SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.product_type='PIECE' AND p.is_active AND p.deleted_at IS NULL AND v.size_unit IN ('KG','GRAM') AND v.deleted_at IS NULL`)).rows[0].n,
};
out.sections.B_packaged_grams_PIECE_by_confidence = (() => {
  const high = out.sections.B_packaged_grams_PIECE.length;
  const medium = out.sections.B_missing_size_unit_active.filter((r) => WEIGHT_WORDS.test(r.productName)).length;
  const low = out.sections.B_missing_size_unit_active.filter((r) => !WEIGHT_WORDS.test(r.productName)).length;
  return { HIGH: high, MEDIUM: medium, LOW: low };
})();

// ---- D. Images: products without any product_images -------------------------------------
out.sections.D_images = {
  active_products_without_images: (await q(`SELECT count(*)::int AS n FROM products p WHERE p.is_active AND p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)`)).rows[0].n,
  active_products_with_images: (await q(`SELECT count(*)::int AS n FROM products p WHERE p.is_active AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)`)).rows[0].n,
  samples: (await q(`SELECT p.id::text AS productId, p.name FROM products p WHERE p.is_active AND p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id) ORDER BY p.name LIMIT 30`)).rows,
};

writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OPERATIONS_CLOSURE/Run_20261119_0630/evidence/p4-catalog-cleanup.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote evidence/p4-catalog-cleanup.json");
await db.end();
