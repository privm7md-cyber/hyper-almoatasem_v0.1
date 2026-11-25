// V1 Real Data Onboarding — POS source report data (read-only):
// - Master_Catalog.csv copies: sizes, mtimes, sha256, byte-identical?
// - How many of the Master_Catalog codes already exist in Primary product_codes.
// Produces evidence/pos-source-report.json.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (t, p) => db.query(t, p);
const out = { generatedAt: new Date().toISOString(), readOnly: true };
const CATALOGS = [
  "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_012224/Work/csv/sheet__Master_Catalog.csv",
  "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_211556/Work/csv/sheet__Master_Catalog.csv",
  "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_211556/Prior_Run_Reference/Work/csv/sheet__Master_Catalog.csv",
];
const files = CATALOGS.map((p) => {
  const buf = readFileSync(p);
  return { path: p, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), mtime: statSync(p).mtime.toISOString().slice(0, 19) };
});
out.catalogFiles = files;
out.allByteIdentical = new Set(files.map((f) => f.sha256)).size === 1;
out.candidateShape = "product master catalog: barcodes (EAN-13) + product names + prices + Previous_Balance/Total_Sold_Master/Current_Balance + category assignments — NOT a POS stock master";
// Parse Master_Catalog: header row, then rows; collect Original_Code values
const lines = readFileSync(CATALOGS[0], "utf8").split(/\r?\n/).filter(Boolean);
const header = lines[0].split(/\s*,/).map((h) => h.trim());
const codeCols = header.filter((h) => h.toLowerCase().includes("code") && h.toLowerCase() !== "code_type");
const codes = new Set();
for (const line of lines.slice(1)) {
  const cells = line.split(/\s*,/).map((c) => c.trim());
  for (const name of codeCols) {
    const i = header.indexOf(name);
    const c = cells[i];
    if (c && c !== "MATCH" && c !== "BARCODE" && /^[A-Za-z0-9._-]{4,40}$/.test(c)) codes.add(c);
  }
}
out.masterCatalog = { header: header.length, dataRows: lines.length - 1, codeColumns: codeCols, uniqueCodes: [...codes].length };
const found = (await q("SELECT count(*)::int AS n FROM product_codes WHERE code = ANY($1::text[])", [[...codes]])).rows[0].n;
out.codes_in_primary = { found, total: (await q("SELECT count(*)::int AS n FROM product_codes")).rows[0].n };
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OPERATIONS_CLOSURE/Run_20261119_0630/evidence/pos-source-report.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ files: out.catalogFiles.length, byteIdentical: out.allByteIdentical, masterCatalog: out.masterCatalog, codes_in_primary: out.codes_in_primary }, null, 2));
await db.end();
