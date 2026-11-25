// V1 Real Data Onboarding — POS dry-run manifest (READ-ONLY on Primary).
// Uses the Backend_Import_Execution Master_Catalog product+barcode+balance files if present
// (no POS master file was found under D:\ — this is the closest real product source).
// Runs the real posImportPreview (loadTargetsByCodes against Primary) to produce a dry-run
// product/import manifest. Writes evidence/pos-dry-run-manifest.json.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s, c, next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s==='next/headers')return next('next/headers.js',c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
const { parseStockCsv } = await import('../src/lib/inventory/import-file.ts');
const { posImportPreview } = await import('../src/lib/inventory/pos-import.ts');

function csvFile(p) { return readFileSync(p, "utf8"); }
function sha256(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }

const CATALOGS = [
  "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_012224/Work/csv/sheet__Master_Catalog.csv",
  "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_211556/Work/csv/sheet__Master_Catalog.csv",
  "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_211556/Prior_Run_Reference/Work/csv/sheet__Master_Catalog.csv",
];
const existing = CATALOGS.map((p) => ({ path: p, hash: sha256(p), size: statSync(p).size, mtime: statSync(p).mtime.toISOString().slice(0, 19) })).filter((x) => x.size > 100);
const versions = existing.map((v) => ({ file: v.path, sha256: v.hash, size: v.size, modified: v.mtime }));
const uniqueHashes = new Set(versions.map((v) => v.sha256));
const latest = versions.reduce((a, b) => (a.modified >= b.modified ? a : b));

// Map Master_Catalog rows to POS columns.
// Parse the Master_Catalog manually: 8.45 MB > the 5 MB upload cap of parseInventoryFile,
// so use the exported RFC4180 parser + the same table shape parseInventoryFile returns.
const rawCsv = csvFile(latest.file);
const grid = parseStockCsv(rawCsv);
const table = {
  sheets: ["Master_Catalog"],
  sheet: "Master_Catalog",
  headers: grid[0].map((h, i) => `${i + 1}: ${h.trim() || "(blank)"}`),
  rows: grid.slice(1).map((cells, i) => ({ row: i + 2, cells })).filter((r) => r.cells.some((c) => c.trim() !== "")),
};
const headers = table.headers;
const colIdx = (name) => headers.findIndex((h) => { const m = h.match(/^(\d+): (.*)$/); return m && m[2].trim() === name; });
const synthRows = table.rows.map((r) => {
  const cells = new Array(headers.length).fill("");
  for (let i = 0; i < headers.length; i++) cells[i] = r.cells[i] ?? "";
  const code = cells[colIdx("Original_Code")]?.trim() || cells[colIdx("Master_Code")]?.trim() || "";
  const name = cells[colIdx("Final_Product_Name")]?.trim() || "";
  const quantity = cells[colIdx("Current_Balance")]?.trim() || "";
  const unit = cells[colIdx("Pack_Size_Unit")]?.trim() || cells[colIdx("Sale_Unit_Candidate")]?.trim() || "";
  const sourcePrice = cells[colIdx("Final_Retail_Price")]?.trim() || "";
  const category = cells[colIdx("Main_Category_Name")]?.trim() || "";
  const status = cells[colIdx("Code_Match_Status")]?.trim();
  return { row: r.row, cells: [code, name, quantity, unit, sourcePrice, category, status] };
});
const syntheticTable = { sheets: ["Master_Catalog"], sheet: "Master_Catalog", headers: ["1: code", "2: name", "3: quantity", "4: unit", "5: sourcePrice", "6: category", "7: matchStatus"], rows: synthRows };

// Dry-run: read-only against Primary via posImportPreview.
const { parsed } = await posImportPreview({ categoryIdDefault: undefined }, syntheticTable);
const out = {
  generatedAt: new Date().toISOString(),
  note: "Read-only simulation on Primary (no writes). No POS master file named POS/pos/master-pos was found under D:\ or Hyper_Data_Review; this uses the Backend_Import_Execution Master_Catalog as the closest real product+barcode+balance source.",
  catalogVersions: versions,
  catalogIdentical: uniqueHashes.size === 1 ? "yes (all Master_Catalog.csv copies byte-identical)" : "no — multiple distinct versions",
  dryRun: parsed,
  summary: { sourceRows: table.rows.length, mappedRows: synthRows.length },
};
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OPERATIONS_CLOSURE/Run_20261119_0630/evidence/pos-dry-run-manifest.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote evidence/pos-dry-run-manifest.json —", JSON.stringify(parsed.summary));
process.exit(0);
