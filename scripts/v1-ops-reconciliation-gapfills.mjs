// P1 — Source/DB reconciliation gap-fills (read-only Primary + MasterCatalog file):
// (a) Primary products/codes not in MasterCatalog
// (b) MasterCatalog internal duplicates
// (c) product_codes unique constraint on `code`
// (d) Primary variants without any product_codes rows
// Produces evidence/reconciliation-gapfills.json.
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
const { Client } = await import("pg");
const { parseStockCsv } = await import("../src/lib/inventory/import-file.ts");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (t, p) => db.query(t, p);
const grid = parseStockCsv(readFileSync("D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_012224/Work/csv/sheet__Master_Catalog.csv", "utf8"));
const headers = grid[0].map((h) => h.trim());
const H = Object.fromEntries(headers.map((h, i) => [h, i]));
const codeOf = (cells) => (cells[H["Original_Code"]] || "").trim() || (cells[H["Master_Code"]] || "").trim();
const masterCodes = grid.slice(1).map(codeOf).filter(Boolean);
const masterDups = masterCodes.filter((c, i) => masterCodes.indexOf(c) !== i);
const masterSet = new Set(masterCodes);
const primaryCodes = (await q("SELECT code::text AS code FROM product_codes ORDER BY code")).rows.map((r) => r.code);
const primarySet = new Set(primaryCodes);
const primaryOnly = primaryCodes.filter((c) => !masterSet.has(c));
const masterOnly = [...masterSet].filter((c) => !primarySet.has(c));
const uqConstraints = (await q("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='product_codes'::regclass AND conname ILIKE '%code%'")).rows;
const variantsWithoutCodes = (await q("SELECT count(*)::int AS n FROM product_variants v LEFT JOIN product_codes c ON c.product_variant_id=v.id WHERE c.id IS NULL")).rows[0].n;
const out = { generatedAt: new Date().toISOString(), readOnly: true,
  masterCatalog: { dataRows: grid.length - 1, uniqueCodes: new Set(masterCodes).size },
  masterCatalogDuplicates: [...new Set(masterDups)],
  masterCatalogDuplicatesCount: new Set(masterDups).size,
  primaryCodesCount: primaryCodes.length,
  primaryOnly_notInMasterCatalog: primaryOnly, primaryOnlyCount: primaryCodes.filter((c) => !masterSet.has(c)).length,
  masterOnly_notInPrimary: masterOnly, masterOnlyCount: masterSet.size - (primaryCodes.length - primaryOnly.length),
  product_codes_code_unique_constraints: uqConstraints,
  variantsWithoutCodes: variantsWithoutCodes,
};
await db.end();
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_DATA_INTEGRITY/Run_20261119_1030/evidence/reconciliation-gapfills.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
