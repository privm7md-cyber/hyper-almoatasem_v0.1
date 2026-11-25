// Read-only real-data reconciliation. It never derives or applies a package
// size from a product name; name evidence is exported for owner review only.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "pg";

const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
if (!outPath) throw new Error("Usage: --out <path>");

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const identity = (await db.query("SELECT current_database() AS database, current_user AS role")).rows[0];
if (identity.database !== "hyper_almoatasem") throw new Error(`Refused: expected Primary, got ${identity.database}`);

const missing = (await db.query(`
  SELECT p.id::text AS product_id, p.name AS product_name, p.product_type, p.unit AS selling_unit,
         v.id::text AS variant_id, v.name AS variant_name,
         v.size_value::text AS size_value, v.size_unit,
         code.code AS product_code,
         CASE
           WHEN v.size_value IS NULL AND v.size_unit IS NULL THEN ARRAY['MISSING_SIZE_VALUE','MISSING_SIZE_UNIT']::text[]
           WHEN v.size_value IS NULL THEN ARRAY['MISSING_SIZE_VALUE','PARTIAL_PAIR']::text[]
           ELSE ARRAY['MISSING_SIZE_UNIT','PARTIAL_PAIR']::text[]
         END AS issues
  FROM product_variants v
  JOIN products p ON p.id=v.product_id
  LEFT JOIN LATERAL (
    SELECT pc.code FROM product_codes pc WHERE pc.product_variant_id=v.id
    ORDER BY pc.is_primary DESC, pc.created_at, pc.id LIMIT 1
  ) code ON true
  WHERE v.deleted_at IS NULL AND (v.size_value IS NULL OR v.size_unit IS NULL)
  ORDER BY p.id, v.id
`)).rows.map((row) => ({ ...row, proposedCorrection: null, status: "OWNER_REVIEW_REQUIRED" }));

const pieceNameEvidence = (await db.query(`
  SELECT p.id::text AS product_id, p.name AS product_name, p.unit AS selling_unit,
         v.id::text AS variant_id, v.name AS variant_name,
         v.size_value::text AS size_value, v.size_unit,
         code.code AS product_code
  FROM products p
  JOIN product_variants v ON v.product_id=p.id AND v.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT pc.code FROM product_codes pc WHERE pc.product_variant_id=v.id
    ORDER BY pc.is_primary DESC, pc.created_at, pc.id LIMIT 1
  ) code ON true
  WHERE p.deleted_at IS NULL AND p.product_type='PIECE'
    AND p.name ~* '[0-9٠-٩۰-۹]+([.,][0-9٠-٩۰-۹]+)?[[:space:]]*(جم|جرام|غرام|كجم|كيلو|كيلوجرام|kg|g)([^[:alpha:]]|$)'
  ORDER BY p.id, v.id
`)).rows.map((row) => ({
  ...row,
  finding: "PACKAGED_PIECE_NAME_EVIDENCE",
  sellingUnitDecision: "KEEP_PIECE",
  proposedCorrection: null,
  note: "Name evidence alone is not authoritative enough to write package metadata.",
}));

const weights = (await db.query(`
  SELECT COUNT(*)::int AS variants,
         COUNT(*) FILTER (WHERE v.size_unit='KG')::int AS kg_basis,
         COUNT(*) FILTER (WHERE v.size_unit IS NULL)::int AS missing_unit,
         COUNT(*) FILTER (WHERE v.size_unit IS NOT NULL AND v.size_unit<>'KG')::int AS conflicting_basis
  FROM product_variants v JOIN products p ON p.id=v.product_id
  WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.product_type='WEIGHT'
`)).rows[0];

const report = {
  generatedAt: new Date().toISOString(), mode: "READ_ONLY_OWNER_REVIEW", identity,
  safety: { inferredWrites: 0, priceChanges: 0, typeReclassifications: 0, productAssignments: 0 },
  summary: {
    variantsMissingAnySizeField: missing.length,
    partialPairs: missing.filter((row) => row.issues.includes("PARTIAL_PAIR")).length,
    packagedPieceNameEvidenceRows: pieceNameEvidence.length,
    weightVariants: weights,
  },
  missingMetadata: missing,
  packagedPieceNameEvidence: pieceNameEvidence,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ generatedAt: report.generatedAt, identity, summary: report.summary }, null, 2));
await db.end();
