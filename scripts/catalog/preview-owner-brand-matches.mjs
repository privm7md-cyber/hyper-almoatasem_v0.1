// Read-only deterministic product/brand matching preview. Never assigns brands.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { buildOwnerBrandManifest, matchProductBrand } from "../../src/lib/catalog/brand-management.ts";

const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const identity = (await db.query("SELECT current_database() AS database, current_user AS role")).rows[0];
buildOwnerBrandManifest(); // validates the supplied catalog before matching
const products = (await db.query(`
  SELECT p.id::text AS product_id, p.name AS product_name,
         code.code AS product_code
  FROM products p
  LEFT JOIN LATERAL (
    SELECT pc.code
    FROM product_variants v
    JOIN product_codes pc ON pc.product_variant_id = v.id
    WHERE v.product_id = p.id AND v.deleted_at IS NULL
    ORDER BY pc.is_primary DESC, pc.created_at ASC, pc.id ASC
    LIMIT 1
  ) code ON true
  WHERE p.deleted_at IS NULL AND p.brand_id IS NULL
  ORDER BY p.id
`)).rows;
const rows = products.map((row) => matchProductBrand({
  productId: row.product_id,
  productCode: row.product_code ?? null,
  productName: row.product_name,
}));
const report = {
  generatedAt: new Date().toISOString(),
  mode: "READ_ONLY_PREVIEW",
  database: identity.database,
  role: identity.role,
  aliasesUsed: [],
  autoApplyPerformed: false,
  summary: {
    productsExamined: rows.length,
    exactVerified: rows.filter((row) => row.classification === "EXACT_VERIFIED").length,
    reviewRequired: rows.filter((row) => row.classification === "REVIEW_REQUIRED").length,
    unmatched: rows.filter((row) => row.classification === "UNMATCHED").length,
  },
  rows,
};
await db.end();
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) writeFileSync(outPath, text, "utf8");
process.stdout.write(`${JSON.stringify({ ...report, rows: undefined }, null, 2)}\n`);
