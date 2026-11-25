// Phase F — product metadata review/preview (READ-ONLY on Primary).
// Flags verified data issues (no writes):
//   1. WEIGHT products without a positive size_unit.
//   2. PIECE products whose variants have size_unit/size_value set (packaged
//      "sealed 500g in a PIECE package" pattern — verified by seller, not by us).
//   3. Variants with no codes (no barcode/internal code).
//   4. Variants without inventory (unknown stock — by design, flagged for info).
// All findings → metadata-preview.json (dry-run manifest; no changes applied).
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { readFileSync } from "node:fs";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const out = { generatedAt: new Date().toISOString(), readOnly: true, db: "hyper_almoatasem (Primary)" };
const f1 = (await c.query(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, v.name AS variantName
  FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE p.product_type = 'WEIGHT' AND (v.size_unit IS NULL OR v.size_unit = '' OR v.size_value IS NULL)
  ORDER BY p.name LIMIT 50`)).rows;
out.weightWithoutUnit = f1;
out.weightWithoutUnitCount = (await c.query("SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.product_type='WEIGHT' AND (v.size_unit IS NULL OR v.size_unit='' OR v.size_value IS NULL)")).rows[0].n;
const f2 = (await c.query(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName, v.name AS variantName
  FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE p.product_type = 'PIECE' AND v.size_unit IS NOT NULL AND v.size_unit != ''
  ORDER BY p.name LIMIT 50`)).rows;
out.pieceWithSizeUnit = f2;
out.pieceWithSizeUnitCount = (await c.query("SELECT count(*)::int AS n FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.product_type='PIECE' AND v.size_unit IS NOT NULL AND v.size_unit != ''")).rows[0].n;
const f3 = (await c.query(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName
  FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN product_codes pc ON pc.product_variant_id = v.id
  WHERE pc.id IS NULL ORDER BY p.name LIMIT 50`)).rows;
out.variantsWithoutCodes = f3;
out.variantsWithoutCodesCount = (await c.query("SELECT count(*)::int AS n FROM product_variants v LEFT JOIN product_codes pc ON pc.product_variant_id=v.id WHERE pc.id IS NULL")).rows[0].n;
const f4 = (await c.query(`
  SELECT v.id::text AS variantId, p.id::text AS productId, p.name AS productName
  FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN inventory i ON i.product_variant_id = v.id
  WHERE i.id IS NULL ORDER BY p.name LIMIT 20`)).rows;
out.variantsWithoutInventory = f4;
out.variantsWithoutInventoryCount = (await c.query("SELECT count(*)::int AS n FROM product_variants v LEFT JOIN inventory i ON i.product_variant_id=v.id WHERE i.id IS NULL")).rows[0].n;
out.noSpeculativeChanges = "nothing applied — Phase F scope: review/preview only (owner may approve corrections later).";
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OWNER_POLICY_UPDATE/Run_20261119_1108/metadata-preview.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ weightWithoutUnit: out.weightWithoutUnitCount, pieceWithSizeUnit: out.pieceWithSizeUnitCount, variantsWithoutCodes: out.variantsWithoutCodesCount, variantsWithoutInventory: out.variantsWithoutInventoryCount }));
await c.end();
