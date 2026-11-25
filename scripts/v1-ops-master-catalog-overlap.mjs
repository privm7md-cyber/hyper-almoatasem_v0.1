// Read-only: do the Backend_Import_Execution catalog codes already exist in Primary (product_codes)?
import { readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const files = {
  "sheet__Master_Catalog.csv": "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_012224/Work/csv/sheet__Master_Catalog.csv",
  "sheet__Master_Catalog (211556)": "D:/Hyper_Data_Review/Backend_Import_Execution/Run_20261018_211556/Work/csv/sheet__Master_Catalog.csv",
};
for (const [label, path] of Object.entries(files)) {
  if (!readFileSync(path, "utf8").length) continue;
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(/\s*,/).map((h) => h.trim());
  const codeCols = header.filter((h) => h.toLowerCase().includes("code"));
  const codeIdx = codeCols.map((c) => header.indexOf(c));
  const codes = new Set();
  for (const line of lines.slice(1)) {
    const cells = line.split(/\s*,\s*/);
    for (const idx of codeIdx) { const c = cells[idx]?.trim(); if (c) codes.add(c); }
  }
  const n = [...codes].length;
  const withComma = [...codes].filter((c) => /[,;\s]/.test(c));
  const found = n ? (await db.query("SELECT count(*)::int AS n FROM product_codes WHERE code = ANY($1::text[])", [[...codes]])).rows[0].n : 0;
  const total = (await db.query("SELECT count(*)::int AS n FROM product_codes")).rows[0].n;
  console.log(`${label}: rows=${lines.length - 1}, unique codes=${n}, codes-with-comma/space=${withComma.length}, codes-found-in-Primary=${found}/${total}`);
  const sample = [...codes].slice(0, 3);
  console.log("  sample codes:", JSON.stringify(sample));
}
await db.end();
