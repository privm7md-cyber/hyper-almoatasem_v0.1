// Phase D — brand matching manifest (read-only on Primary).
// Matches the owner's supplied brand list against products.name (deterministic,
// explainable): exact / normalized-substring / fuzzy-candidate / UNMATCHED.
// Output: branding-match-manifest.json
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Owner-supplied brand list (2026-11-19). One canonical record per brand —
// the two mentioned-multiple-times ("المراعي", "شيبسي") are deduped here.
const OWNER_BRANDS = [
  "بيبسي", "كوكاكولا", "المراعي", "شيبسي", "لايون", "تايجر", "بيك شبسي", "ابو عوف", "مصري كافيه", "كوفي بريك",
  "بن عبد المعبود", "بن الدلة", "بن شهين", "بونجورنو ليبتون", "العروسة", "أحمد تي", "الكابوس", "إزيس", "دريم", "ماجي",
  "كنور", "ويلز", "الضحى", "العمدة", "الفيروز", "الساعة", "ريحانه", "الملكة", "استار", "دولفين", "صن شاين", "فتراك",
  "رشيدي الميزان", "حلواني", "كريستال", "روابي", "قوت", "جنة", "الهانم", "عافية", "جهينه", "دورا", "هاينز", "جردينيو",
  "فاين", "مولفيكس", "جود كير", "اوكسي", "اريل", "برسيل باهي فريدا", "ريد", "فيبا", "جلاس اكس", "فوج", "لوكس", "جوي",
  "كميه", "ايديتا", "اولكر", "رودس", "عبور", "دومتي", "كاريبي", "الوادي", "اندومي",
];

function norm(s) {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u0640\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim();
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const m = [...Array(a.length + 1)].map(() => [...Array(b.length + 1)].fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return m[a.length][b.length];
}
function findMatches(brandName, productNames) {
  const b = norm(brandName);
  const scored = productNames.map((p, i) => {
    const n = norm(p);
    if (n === b) return { score: 0, idx: i, kind: "VERIFIED_EXACT" };
    if (n.includes(b) && b.length >= 2) return { score: 1, idx: i, kind: "VERIFIED_SUBSTRING" };
    const d = lev(b, n);
    if (b.length >= 3 && d <= Math.max(2, Math.floor(b.length / 4)) && d <= 2) return { score: 2, idx: i, kind: "VERIFIED_FUZZY", dist: d };
    return { score: 99, idx: -1, kind: null };
  }).filter((x) => x.score < 90).sort((x, y) => x.score - y.score);
  return scored;
}

const products = (await c.query(`SELECT id::text AS id, name FROM products WHERE is_active AND deleted_at IS NULL ORDER BY name`)).rows.map((r) => r.name);
const existing = (await c.query(`SELECT id::text AS id, name FROM brands WHERE is_active AND deleted_at IS NULL ORDER BY name`)).rows.map((r) => r.name);

const manifest = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  db: "hyper_almoatasem (Primary)",
  brandCounts: { ownerList: OWNER_BRANDS.length, products: products.length, brandsInPrimary: existing.length },
  manifest: OWNER_BRANDS.map((b) => {
    const prodMatch = findMatches(b, products);
    const inPrimary = existing.filter((e) => norm(e).includes(norm(b)) || norm(b).includes(norm(e)));
    const top = prodMatch[0];
    return {
      brand: b,
      norm: norm(b),
      classification: top ? top.kind : (inPrimary.length ? "VERIFIED_IN_PRIMARY_ONLY" : "UNMATCHED"),
      matches: prodMatch.slice(0, 3).map((m) => ({ product: products[m.idx], score: m.score, dist: m.dist })),
      inPrimary: inPrimary.slice(0, 3),
      ambiguous: prodMatch.length >= 2 && top && top.score !== 1 && top.score !== 0,
    };
  }),
  summary: { verified: 0, unmatched: 0, reviewRequired: 0 },
};
for (const m of manifest.manifest) {
  if (m.classification?.startsWith("VERIFIED")) manifest.summary.verified++;
  else if (m.ambiguous) manifest.summary.reviewRequired++;
  else manifest.summary.unmatched++;
}

writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OWNER_POLICY_UPDATE/Run_20261119_1108/branding-match-manifest.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest.summary));
console.log("unmatched:", manifest.manifest.filter((m) => m.classification === "UNMATCHED").map((m) => m.brand).join(" | "));
console.log("reviewRequired:", manifest.manifest.filter((m) => m.ambiguous).map((m) => m.brand).join(" | "));
await c.end();
