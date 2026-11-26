// P1 — POS Price Conflict Investigation (read-only on Primary).
// Parses Backend_Import_Execution/.../sheet__Master_Catalog.csv (9,531 rows),
// joins codes to Primary product_variants (SELECT-only), and classifies price
// differences into root-cause categories. Produces evidence/pos-price-conflicts.json.
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s==='next/headers')return next('next/headers.js',c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
const { Client } = await import("pg");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (t, p) => db.query(t, p);
const { parseStockCsv } = await import('../src/lib/inventory/import-file.ts');

const MC_PATH = "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_012224/Work/csv/sheet__Master_Catalog.csv";
const grid = parseStockCsv(readFileSync(MC_PATH, "utf8"));
const headers = grid[0].map((h) => h.trim());
const H = Object.fromEntries(headers.map((h, i) => [h, i]));
const rows = grid.slice(1);

// Collect codes from Primary (read-only)
const codes = [...new Set(rows.map((r) => r[H["Original_Code"]]?.trim() || r[H["Master_Code"]]?.trim()).filter(Boolean))];
const primaryRows = (await q("SELECT code::text AS code, v.price::text AS price, v.compare_at_price::text AS compareAt, v.cost_price::text AS cost, p.name AS name FROM product_codes c JOIN product_variants v ON v.id=c.product_variant_id JOIN products p ON p.id=v.product_id WHERE c.code=ANY($1::text[])", [codes])).rows;
const byCode = new Map(primaryRows.map((r) => [r.code, r]));

// Classification of differences
const toCents = (s) => Math.round(parseFloat(s ?? "0") * 100) || 0;
const categorize = (source, current) => {
  if (source === "" ) return "missing_source_price";
  if (current === null) return "no_current_price_field_primary";
  const s = toCents(source), c = toCents(current);
  if (s === c) return "exact_match";
  const diff = Math.abs(s - c);
  if (s === 0 || c === 0) return "zero_on_one_side";
  if (diff <= 20) return "rounding_or_format"; // ≤0.20 EGP — noise
  const rel = diff / Math.max(1, Math.abs(c));
  if (rel <= 0.01) return "percent_rounding_noise";
  return "price_diff_revision";
};

const stringDiffs = [];
let stringDiffCount = 0;
let masterGenRealDiff = 0;

const conflicts = [];
const byCat = {};
let matched = 0, notMatched = 0;
for (const row of rows) {
  const code = row[H["Original_Code"]]?.trim() || row[H["Master_Code"]]?.trim() || "";
  const name = row[H["Final_Product_Name"]]?.trim();
  const sourcePrice = row[H["Final_Retail_Price"]]?.trim() || "";
  const masterRef = row[H["Master_General_Price_Reference"]]?.trim() || "";
  const unit = row[H["Pack_Size_Unit"]]?.trim() || row[H["Sale_Unit_Candidate"]]?.trim() || "";
  const prodType = row[H["Sale_Type_Candidate"]]?.trim();
  const t = byCode.get(code);
  if (!t) { notMatched++; continue; }
  matched++;
  if (sourcePrice && t.price && sourcePrice !== t.price) { stringDiffCount++; if (stringDiffs.length < 15) stringDiffs.push({ code, name, sourcePrice, current: t.price, masterGeneral: masterRef || null }); }
  if (masterRef && t.price && toCents(masterRef) - toCents(t.price) !== 0) masterGenRealDiff++;
  const cat = categorize(sourcePrice, t.price);
  byCat[cat] = (byCat[cat] ?? 0) + 1;
  if (cat !== "exact_match" && cat !== "missing_source_price" && cat !== "no_current_price_field_primary") {
    if (conflicts.length < 30) conflicts.push({
      code, name, unit, prodType,
      sourcePrice: sourcePrice || null, masterGeneral: masterRef || null, currentPrice: t.price,
      category: cat,
    });
  }
}
// Exact-match breakdown of material diffs:
const totalDiffs = (Object.entries(byCat).find(([k]) => k === "price_diff_revision") || [, 0])[1];

const out = {
  generatedAt: new Date().toISOString(),
  db: "hyper_almoatasem",
  readOnly: true,
  masterCatalog: { path: MC_PATH, dataRows: rows.length, uniqueCodes: new Set(rows.map((r) => r[H["Original_Code"]]?.trim() || r[H["Master_Code"]]?.trim()).filter(Boolean)).size, header: headers.length, mtime: readFileSync(MC_PATH).length },
  primary: { product_codes_total: (await q("SELECT count(*)::int AS n FROM product_codes")).rows[0].n },
  counts: { rows: rows.length, matched, notMatched },
  stringLevelDiffCount: stringDiffCount,
  stringDiffSamples: stringDiffs,
  masterGeneralVsCurrent_realDiffCount: masterGenRealDiff,
  categories: byCat,
  totalMaterialDiffCount: totalDiffs,
  sample: conflicts,
  notes: "priceConflictCount = rows where |source - current| > 0.20 EGP and neither is 0 (the observed 9,180). Root causes are classified into categories; interpretation must be reviewed by the owner — differences are NOT auto-applied.",
};
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_DATA_INTEGRITY/Run_20261119_1030/evidence/pos-price-conflicts.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ matched, notMatched, byCat, totalMaterialDiffCount: totalDiffs }, null, 2));
await db.end();
