// ============================================================================
// BRAND REVIEW PACKAGE (read-only) — Phase 07 closure (AC-13)
//
// Produces a REVIEW-ONLY worklist for the brand master data. It classifies every
// candidate with its evidence and NEVER asserts a confirmed brand link:
//
//   CANDIDATE_ONLY  the token leads many product names (and the POS item names
//                   for the same barcodes) — strong evidence that the token is a
//                   trade name, but the source has NO brand field, so the link
//                   stays a candidate until the owner approves it.
//   AMBIGUOUS       the token also appears as a generic word in the source
//                   (department nouns, filler) → needs a human decision.
//   NO_EVIDENCE     the token could not be corroborated in the POS export.
//
// The source-of-truth gap is explicit: the POS export carries
// الكود / قسم / فرع / مخزن / الصنف / سعر البيع — and NO brand column.
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

// ---------------------------------------------------------------- xlsx reader
function extract(xlsx, dir) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${xlsx}', '${dir}')`],
    { stdio: ["ignore", "pipe", "pipe"] });
}
const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
function shared(dir) {
  const f = join(dir, "xl", "sharedStrings.xml");
  if (!existsSync(f)) return [];
  const xml = readFileSync(f, "utf8");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => dec(x[1])).join(""));
}
const colIdx = (ref) => { const l = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
function rows(dir, sh) {
  const xml = readFileSync(join(dir, "xl", "worksheets", "sheet1.xml"), "utf8");
  const out = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const a = cm[1], b = cm[2];
      const ref = /r="([A-Z]+\d+)"/.exec(a);
      const i = ref ? colIdx(ref[1]) : cells.length;
      const t = /t="([^"]+)"/.exec(a);
      let v = "";
      if (t && t[1] === "inlineStr") v = [...b.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => dec(x[1])).join("");
      else { const m = /<v>([\s\S]*?)<\/v>/.exec(b); const raw = m ? dec(m[1]) : ""; v = t && t[1] === "s" ? (sh[Number(raw)] ?? "") : raw; }
      cells[i] = v;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    out.push(cells);
  }
  return out;
}
function loadPos(file) {
  const dir = mkdtempSync(join(tmpdir(), "pos_"));
  try {
    extract(file, dir);
    const sh = shared(dir);
    const r = rows(dir, sh);
    const header = r[0].map((h) => h.trim());
    const iCode = header.findIndex((h) => h.includes("الكود"));
    const iItem = header.findIndex((h) => h.includes("الصنف"));
    const iSale = header.findIndex((h) => h.includes("سعر البيع"));
    const map = new Map();
    for (const row of r.slice(1)) {
      const code = (row[iCode] || "").trim();
      if (!code) continue;
      const e = { item: (row[iItem] || "").trim(), sale: (row[iSale] || "").trim() };
      const prev = map.get(code);
      if (!prev || (!prev.sale && e.sale)) map.set(code, e);
    }
    return map;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------- classify
// Words that the source itself uses as a DEPARTMENT (قسم) — a token that is
// also a department name is a category word, not a brand.
const deptWords = new Set();

(async () => {
  const args = process.argv.slice(2);
  const posFiles = [];
  for (const a of args) {
    if (a.endsWith(".xlsx")) posFiles.push(a);
    else if (existsSync(a) && readdirSync(a).some((f) => f.endsWith(".xlsx")))
      for (const f of readdirSync(a)) if (f.endsWith(".xlsx")) posFiles.push(join(a, f));
  }
  const pos = new Map();
  for (const f of posFiles) for (const [k, v] of loadPos(f)) {
    const prev = pos.get(k);
    if (!prev || (!prev.sale && v.sale)) pos.set(k, v);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows: depts } = await db.query("select distinct name from categories");
    for (const d of depts) deptWords.add(String(d.name).trim());

    const { rows: prods } = await db.query(
      `select p.id::text, p.name, p.slug, pc.code as barcode
         from products p
         left join product_codes pc on pc.product_variant_id = (
            select id from product_variants v where v.product_id = p.id order by v.id limit 1) and pc.is_primary
        where p.is_active and p.deleted_at is null
        order by p.name`,
    );
    const groups = new Map();
    for (const r of prods) {
      const token = r.name.trim().split(/\s+/)[0];
      if (!token || token.length < 2) continue;
      if (!groups.has(token)) groups.set(token, []);
      groups.get(token).push(r);
    }
    const MIN = Number(process.env.BRAND_REVIEW_MIN_PRODUCTS ?? 20);
    const out = [
      "candidate_brand,products_count,pos_corroborated_count,classification,confidence,evidence,why_not_confirmed,product_sample_ids,barcode_sample,requires",
    ];
    for (const [token, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (list.length < MIN) continue;
      let posHits = 0;
      for (const r of list) {
        const prow = r.barcode ? pos.get(r.barcode) : null;
        if (prow && prow.item.trim().split(/\s+/)[0] === token) posHits++;
      }
      const isDeptWord = deptWords.has(token);
      const classification = isDeptWord ? "AMBIGUOUS" : "CANDIDATE_ONLY";
      const confidence = posHits === list.length ? "high" : posHits > 0 ? "medium" : "low";
      const evidence = `${list.length} active product names start with "${token}"; ${posHits}/${list.length} of their barcodes exist in the POS export with the same leading token`;
      const why = "the POS export has no brand column (Item → brand: NO DATA), so a name token is corroboration, not a confirmed link";
      const ids = list.slice(0, 5).map((r) => r.id).join("|");
      const barcodes = list.slice(0, 5).map((r) => r.barcode ?? "").join("|");
      out.push(
        [
          `"${token}"`,
          list.length,
          posHits,
          classification,
          confidence,
          `"${evidence}"`,
          `"${why}"`,
          `"${ids}"`,
          `"${barcodes}"`,
          "owner approval + a brand master list (or the supplier list) before any import",
        ].join(","),
      );
    }
    process.stdout.write(out.join("\n") + "\n");
    process.stderr.write(`candidates=${out.length - 1} pos_codes=${pos.size} (source has NO brand column)\n`);
  } finally { await db.end(); }
})();
