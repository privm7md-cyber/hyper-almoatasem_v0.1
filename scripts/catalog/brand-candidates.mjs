// ============================================================================
// BRAND CANDIDATE REVIEW (read-only) — Phase 07 (D03)
// ============================================================================
// PURPOSE: prepare a REVIEW-ONLY candidate list of brand names for the owner's
// approval. It NEVER writes anything: it only reads the catalog and prints a
// CSV that a human must review before any brand record is created.
//
// WHY A REVIEW LIST AND NOT LINKS: the project's own data-source audit
// (docs/data-sources/PHASE-01-STORE-DATA-SOURCE-INVENTORY.md) states that the
// POS exports carry NO brand field ("Item → brand: NO DATA", U-08: needs a
// supplier/brand master list). The only signal available here is the product
// NAME, and a name prefix is a CANDIDATE, not a fact — per D03, candidates
// never become confirmed links without a reliable source.
//
// METHOD: group products by the first whitespace token of their name; a token
// that appears on many products is a strong candidate (e.g. a house brand).
// Every row lists the token, how many products carry it, and sample names so a
// reviewer can approve/reject each candidate explicitly.
//
// USAGE (read-only):
//   node --env-file=.env scripts/catalog/brand-candidates.mjs > review.csv
// ============================================================================
import "dotenv/config";
import { Client } from "pg";

const MIN_PRODUCTS = Number(process.env.BRAND_CANDIDATE_MIN_PRODUCTS ?? 20);

function slugify(name) {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .toLowerCase();
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query(
    `SELECT p.id::text AS id, p.name, p.slug, p.is_active
       FROM products p
      WHERE p.is_active AND p.deleted_at IS NULL
      ORDER BY p.name`,
  );
  const groups = new Map();
  for (const row of rows) {
    const token = row.name.trim().split(/\s+/)[0];
    if (!token || token.length < 2) continue;
    if (!groups.has(token)) groups.set(token, []);
    groups.get(token).push(row);
  }
  const candidates = [...groups.entries()]
    .filter(([, list]) => list.length >= MIN_PRODUCTS)
    .sort((a, b) => b[1].length - a[1].length);

  const out = ["candidate_name,products_count,suggested_slug,product_ids,sample_names"];
  for (const [token, list] of candidates) {
    const ids = list.map((r) => r.id).join("|");
    const samples = list
      .slice(0, 5)
      .map((r) => `"${r.name.replace(/"/g, '""')}"`)
      .join(" | ");
    out.push(`"${token}",${list.length},${slugify(token)},"${ids}","${samples}"`);
  }
  process.stdout.write(out.join("\n") + "\n");
  process.stderr.write(
    `candidates=${candidates.length} products_scanned=${rows.length} min_products=${MIN_PRODUCTS}\n`,
  );
} finally {
  await db.end();
}
