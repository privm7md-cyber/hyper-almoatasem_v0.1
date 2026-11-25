// Brand reconciliation (READ-ONLY on Primary): DB brands vs owner-supplied list.
// Strict token/phrase matching (no loose substring), so "اريل" does not match
// "موزاريلا". Output: _recovery/v1-ops/evidence/brand-reconcile.json
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];

const manifest = JSON.parse(readFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OWNER_POLICY_UPDATE/Run_20261119_1108/branding-match-manifest.json", "utf8"));
const owner = manifest.manifest.map((row) => row.brand);

function norm(s) {
  return s.toLowerCase().normalize("NFKC")
    .replace(/[\u0640\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}
function tokens(s) {
  return norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
function containsPhrase(productName, brandName) {
  const p = tokens(productName);
  const b = tokens(brandName);
  if (b.length === 0) return false;
  for (let i = 0; i + b.length <= p.length; i++) {
    let ok = true;
    for (let j = 0; j < b.length; j++) if (p[i + j] !== b[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const dbBrands = (await c.query("SELECT id::text AS id, name, slug, is_active, created_at FROM brands WHERE deleted_at IS NULL ORDER BY name")).rows;
const products = (await c.query("SELECT name FROM products WHERE is_active AND deleted_at IS NULL")).rows.map((r) => r.name);

const dbByNorm = new Map(dbBrands.map((b) => [norm(b.name), b]));
const ownerNorms = new Set(owner.map(norm));
const rows = owner.map((brand) => {
  const inDb = dbByNorm.get(norm(brand)) ?? null;
  const matches = inDb ? [] : products.filter((name) => containsPhrase(name, brand)).slice(0, 5);
  return {
    brand,
    inDatabase: Boolean(inDb),
    dbName: inDb?.name ?? null,
    dbCreatedAt: inDb?.created_at ?? null,
    productTokenMatches: matches,
    classification: inDb ? "IN_DATABASE" : matches.length ? "PRODUCT_TOKEN_MATCH_ONLY" : "UNMATCHED",
  };
});
const ownerNotInDb = rows.filter((r) => !r.inDatabase).map((r) => r.brand);
const dbNotInOwner = dbBrands.filter((b) => !ownerNorms.has(norm(b.name))).map((b) => b.name);
const unresolved = rows.filter((r) => r.classification === "UNMATCHED").map((r) => r.brand);

const out = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  database: "hyper_almoatasem (Primary)",
  counts: { dbBrands: dbBrands.length, ownerList: owner.length, inDatabase: rows.filter((r) => r.inDatabase).length, productTokenMatchOnly: rows.filter((r) => r.classification === "PRODUCT_TOKEN_MATCH_ONLY").length, unmatched: unresolved.length, dbNotInOwner: dbNotInOwner.length },
  ownerNotInDb,
  dbNotInOwner,
  unresolved,
  dbBrands,
  rows,
};
writeFileSync("_recovery/v1-ops/evidence/brand-reconcile.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.counts));
await c.end();
