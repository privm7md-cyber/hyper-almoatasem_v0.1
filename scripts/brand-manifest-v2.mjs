// Brand matching manifest v2 (READ-ONLY on Primary).
// - Strict token/phrase matching (no loose substring): "اريل" != "موزاريلا".
// - Cross-language/spelling candidate map for known Arabic <-> Latin pairs.
// - Actionable per-DB-brand product counts for a future reviewed assignment.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];

const prior = JSON.parse(readFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OWNER_POLICY_UPDATE/Run_20261119_1108/branding-match-manifest.json", "utf8"));
const ownerList = prior.manifest.map((row) => row.brand);

function norm(s) {
  return s.toLowerCase().normalize("NFKC")
    .replace(/[\u0640\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}
function tokens(s) { return norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
function containsPhrase(productName, brandName) {
  const p = tokens(productName);
  const b = tokens(brandName);
  for (let i = 0; i + b.length <= p.length; i++) {
    let ok = true;
    for (let j = 0; j < b.length; j++) if (p[i + j] !== b[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// Owner token -> candidate DB brand names (cross-language / spelling / compound).
const CANDIDATES = {
  "ابو عوف": ["Abu Auf"], "كوفي بريك": ["Coffee Break"], "دريم": ["Dream"],
  "ويلز": ["Wells"], "ريحانه": ["رحانة"], "مولفيكس": ["malfix"],
  "جود كير": ["good care"], "اوكسي": ["Oxy"], "اريل": ["Ariel"],
  "فيبا": ["Feba"], "فوج": ["Fog"], "لوكس": ["Lux"], "جوي": ["Joy"],
  "بيك شبسي": ["بيك"], "رشيدي الميزان": ["الميزان", "رشيد"],
  "بونجورنو ليبتون": ["Buongiorno"],
  "برسيل باهي فريدا": ["Persil", "Bahi", "Farida"],
};
const REVIEW = new Set(["بيك شبسي", "رشيدي الميزان", "برسيل باهي فريدا"]);
const UNRESOLVED = new Set(["بن عبد المعبود", "بونجورنو ليبتون", "جردينيو", "برسيل باهي فريدا", "جلاس اكس", "كميه", "ايديتا"]);

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const dbBrands = (await c.query("SELECT id::text AS id, name, slug, is_active, created_at FROM brands WHERE deleted_at IS NULL ORDER BY name")).rows;
const products = (await c.query("SELECT name FROM products WHERE is_active AND deleted_at IS NULL")).rows.map((r) => r.name);
const dbByNorm = new Map(dbBrands.map((b) => [norm(b.name), b]));

// Every DB brand's strict product-name coverage (using its own name only).
const dbManifest = dbBrands.map((b) => {
  const hits = products.filter((name) => containsPhrase(name, b.name));
  return { id: b.id, name: b.name, slug: b.slug, isActive: b.is_active, createdAt: b.created_at, productMatchCount: hits.length, sampleProducts: hits.slice(0, 3) };
});

const ownerRows = ownerList.map((brand) => {
  const exact = dbByNorm.get(norm(brand)) ?? null;
  const candidates = (CANDIDATES[brand] ?? []).filter((n) => dbByNorm.has(norm(n)));
  const productHits = products.filter((name) => containsPhrase(name, brand));
  const status = UNRESOLVED.has(brand) ? "UNRESOLVED"
    : REVIEW.has(brand) ? "REVIEW_REQUIRED"
    : exact ? "IN_DATABASE"
    : candidates.length ? "CROSS_LANGUAGE_DB_CANDIDATE"
    : productHits.length ? "PRODUCT_TOKEN_MATCH_ONLY"
    : "UNRESOLVED";
  return {
    brand, status,
    dbName: exact?.name ?? null,
    dbCandidates: candidates,
    productTokenMatchCount: productHits.length,
    sampleProducts: productHits.slice(0, 3),
  };
});

const count = (status) => ownerRows.filter((r) => r.status === status).length;
const out = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  database: "hyper_almoatasem (Primary)",
  method: "strict Arabic normalization + token/phrase matching; no loose substring matches; explicit candidate crosswalk",
  counts: {
    dbBrands: dbBrands.length,
    ownerListCaptured: ownerList.length,
    inDatabase: count("IN_DATABASE"),
    crossLanguageCandidate: count("CROSS_LANGUAGE_DB_CANDIDATE"),
    productTokenOnly: count("PRODUCT_TOKEN_MATCH_ONLY"),
    reviewRequired: count("REVIEW_REQUIRED"),
    unresolved: count("UNRESOLVED"),
    dbBrandsWithProductMatches: dbManifest.filter((b) => b.productMatchCount > 0).length,
    totalProductsActive: products.length,
  },
  unresolvedBrands: ownerRows.filter((r) => r.status === "UNRESOLVED").map((r) => r.brand),
  reviewBrands: ownerRows.filter((r) => r.status === "REVIEW_REQUIRED").map((r) => r.brand),
  ownerRows,
  dbManifest,
};
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OWNER_POLICY_UPDATE/Run_20261119_1108/branding-match-manifest-v2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.counts));
console.log("UNRESOLVED", JSON.stringify(out.unresolvedBrands));
await c.end();
