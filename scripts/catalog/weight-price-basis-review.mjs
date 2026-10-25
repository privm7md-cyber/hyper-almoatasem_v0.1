// ============================================================================
// WEIGHT PRICE-BASIS REVIEW (read-only) — Phase 07 closure (AC-13 / price integrity)
//
// For every WEIGHT product whose variant unit is not KG, the stored price is
// cross-checked against the REAL POS export (barcode → item → sale price).
// The POS export is the project's own commercial source (documented in
// docs/data-sources/PHASE-01-STORE-DATA-SOURCE-INVENTORY.md); the catalog
// carries the same barcode in product_codes, so the join is a fact, not a guess.
//
// Classifications (evidence-based, never inferred from the price alone):
//   VERIFIED_PRICE_PER_KG          the source sells the unit by the kilogram
//                                  (1 kg unit or "by weight"), so the stored
//                                  value IS the per-kg price.
//   VERIFIED_PACK_PRICE            the source sells a fixed pack (85 g … 450 g)
//                                  at the stored value → a per-pack price.
//   CONTRACT_OR_DATA_INCONSISTENCY the source item is not a weight sale at all
//                                  (e.g. a multi-pack bundle) or the stored
//                                  value differs from the source.
//
// Usage (read-only, local DB):
//   node --env-file=.env scripts/catalog/weight-price-basis-review.mjs "<pos.xlsx>" [...]
// ============================================================================
import "dotenv/config";
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

// ---------------------------------------------------------------- xlsx reader
function extract(xlsx, dir) {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command",
     `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${xlsx}', '${dir}')`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}
const decodeEntities = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
   .replace(/&amp;/g, "&");
function sharedStrings(dir) {
  const f = join(dir, "xl", "sharedStrings.xml");
  if (!existsSync(f)) return [];
  const xml = readFileSync(f, "utf8");
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1])).join(""));
  }
  return out;
}
const colIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
function sheetRows(dir, shared) {
  const xml = readFileSync(join(dir, "xl", "worksheets", "sheet1.xml"), "utf8");
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1];
      const body = cm[2];
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      const typeM = /t="([^"]+)"/.exec(attrs);
      let value = "";
      if (typeM && typeM[1] === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeEntities(x[1])).join("");
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        const raw = v ? decodeEntities(v[1]) : "";
        value = typeM && typeM[1] === "s" ? (shared[Number(raw)] ?? "") : raw;
      }
      cells[idx] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return rows;
}
function loadPos(file) {
  const dir = mkdtempSync(join(tmpdir(), "pos_"));
  try {
    extract(file, dir);
    const shared = sharedStrings(dir);
    const rows = sheetRows(dir, shared);
    const header = rows[0].map((h) => h.trim());
    const idx = (name) => header.findIndex((h) => h.includes(name));
    const iCode = idx("الكود");
    const iItem = idx("الصنف");
    const iSale = idx("سعر البيع");
    const map = new Map();
    for (const r of rows.slice(1)) {
      const code = (r[iCode] || "").trim();
      if (!code) continue;
      const entry = { item: (r[iItem] || "").trim(), sale: (r[iSale] || "").trim() };
      const prev = map.get(code);
      if (!prev || (!prev.sale && entry.sale) || (!prev.item && entry.item)) map.set(code, entry);
    }
    return map;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ classify
/** Weight-signalling words in the POS item name (source text, not inference). */
const KG_IN_NAME = /(كجم|كيلو)/;
// "by weight" wording in the source ("بر ميزان" / "برو ميزان" / "بمیزان").
const BY_WEIGHT_IN_NAME = /(بر ?و? ?[مي]يزان|ب[مي]يزان)/;

function classify({ posItem, posSale, catalogPrice, sizeValue, sizeUnit }) {
  const pack = sizeValue ? Number(sizeValue) : null;
  const pos = posSale === "" ? null : Number(posSale);
  if (pos === null) {
    return {
      classification: "NO_EVIDENCE",
      basis: "the POS export has no row for this barcode",
      impliedPerKg: null,
    };
  }
  const equal = Math.abs(pos - catalogPrice) < 0.0001;
  if (!equal) {
    return {
      classification: "CONTRACT_OR_DATA_INCONSISTENCY",
      basis: `stored price ${catalogPrice} differs from the source item price ${pos}`,
      impliedPerKg: pack ? (pos * 1000) / pack : null,
    };
  }
  if (pack) {
    return {
      classification: "VERIFIED_PACK_PRICE",
      basis: `the source sells a fixed ${pack} ${sizeUnit} pack at ${pos}`,
      impliedPerKg: (pos * 1000) / pack,
    };
  }
  if (KG_IN_NAME.test(posItem)) {
    return {
      classification: "VERIFIED_PRICE_PER_KG",
      basis: `the source unit is one kilogram ("${posItem}") at ${pos} — a kilogram price`,
      impliedPerKg: pos,
    };
  }
  if (BY_WEIGHT_IN_NAME.test(posItem)) {
    return {
      classification: "VERIFIED_PRICE_PER_KG",
      basis: `the source sells it by weight ("${posItem}") at ${pos} — a kilogram price`,
      impliedPerKg: pos,
    };
  }
  return {
    classification: "AMBIGUOUS_PRICE_BASIS",
    basis: `stored price equals the source item price (${pos}) but the source unit is not stated`,
    impliedPerKg: null,
  };
}

// --------------------------------------------------------------------- main
// Arguments: .xlsx paths and/or directories to scan. A directory keeps the
// call safe for Arabic file names that contain spaces.
const args = process.argv.slice(2);
const posFiles = [];
for (const a of args) {
  if (a.endsWith(".xlsx")) posFiles.push(a);
  else if (existsSync(a) && readdirSync(a).some((f) => f.endsWith(".xlsx"))) {
    for (const f of readdirSync(a)) if (f.endsWith(".xlsx")) posFiles.push(join(a, f));
  }
}
if (posFiles.length === 0) {
  process.stderr.write("no POS export given — pass .xlsx paths or a directory\n");
  process.exit(2);
}
const pos = new Map();
for (const f of posFiles) for (const [k, v] of loadPos(f)) {
  const prev = pos.get(k);
  if (!prev || (!prev.sale && v.sale)) pos.set(k, v);
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query(
    `SELECT p.id::text AS product_id, p.name AS product_name, p.product_type,
            p.unit AS product_unit, p.sale_step_grams,
            v.id::text AS variant_id, v.name AS variant_name,
            v.size_value, v.size_unit, v.price,
            pc.code AS barcode
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_codes pc ON pc.product_variant_id = v.id AND pc.is_primary
      WHERE p.is_active AND p.deleted_at IS NULL AND v.is_active AND v.deleted_at IS NULL
        AND p.product_type = 'WEIGHT' AND (v.size_unit IS NULL OR v.size_unit <> 'KG')
      ORDER BY p.name`,
  );
  const header = [
    "product_id", "product_name", "barcode", "sale_type", "variant_id", "variant_unit",
    "variant_size_value", "stored_price", "price_field", "pos_item_name", "pos_sale_price",
    "price_equals_source", "classification", "evidence", "implied_per_kg_if_pack_priced",
    "interim_behavior", "required_resolution",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const posRow = r.barcode ? pos.get(r.barcode) : null;
    const verdict = classify({
      posItem: posRow?.item ?? "",
      posSale: posRow?.sale ?? "",
      catalogPrice: Number(r.price),
      sizeValue: r.size_value,
      sizeUnit: r.size_unit ?? "",
    });
    const unit = (r.size_unit ?? "").toUpperCase();
    const interim =
      verdict.classification === "VERIFIED_PRICE_PER_KG" && unit === "KG"
        ? "sold by weight at the per-kg price (the implemented rule)"
        : verdict.classification === "VERIFIED_PRICE_PER_KG"
          ? "the source price IS a per-kg price, but the variant sale unit is not KG — the storefront therefore sells it as a fixed pack and blocks weight selection (safe, no wrong-money line)"
          : "sold as a fixed pack — weight selection is blocked so no wrong-money order line can be created";
    const resolution =
      verdict.classification === "VERIFIED_PRICE_PER_KG" && unit === "KG"
        ? "none — the storefront behaviour already matches the source"
        : verdict.classification === "VERIFIED_PRICE_PER_KG"
          ? "owner data action: set the variant sale unit to KG — the storefront will then sell it by weight at the same per-kg price"
          : verdict.classification === "VERIFIED_PACK_PRICE"
            ? "owner data action: either set the price to the per-kilogram value (implied column) or re-type the product as PIECE — until then the pack sale is source-correct"
            : verdict.classification === "CONTRACT_OR_DATA_INCONSISTENCY"
              ? "owner decision: the source item is not a weight sale — correct the price to the source value and re-type the product as PIECE"
              : "owner decision: the source does not state the unit — supply the master data before any weight sale";
    lines.push([
      r.product_id,
      `"${r.product_name}"`,
      r.barcode ?? "",
      r.product_type,
      r.variant_id,
      r.size_unit ?? "",
      r.size_value ?? "",
      r.price,
      "product_variants.price",
      `"${(posRow?.item ?? "").replace(/"/g, '""')}"`,
      posRow?.sale ?? "",
      posRow && Math.abs(Number(posRow.sale) - Number(r.price)) < 0.0001 ? "yes" : "no",
      verdict.classification,
      `"${verdict.basis.replace(/"/g, '""')}"`,
      verdict.impliedPerKg === null ? "" : verdict.impliedPerKg.toFixed(2),
      `"${interim}"`,
      `"${resolution}"`,
    ].join(","));
  }
  process.stdout.write(lines.join("\n") + "\n");
  process.stderr.write(`rows=${rows.length} pos_codes=${pos.size}\n`);
} finally {
  await db.end();
}
