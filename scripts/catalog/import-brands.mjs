// ============================================================================
// BRAND IMPORT (writes) — Phase 07 closure (AC-13)
//
// Applies an OWNER-APPROVED brand mapping. It never decides brands: the input
// is a reviewed CSV (build the candidate worklist with
// scripts/catalog/brand-review-package.mjs — every row there is CANDIDATE_ONLY
// until the owner approves it).
//
// Input CSV (header required):
//   brand_name,slug,product_ids
//   "الفيروز","الفيروز","uuid1|uuid2|…"
//   slug is optional (derived from the name when missing).
//
// Safety rules (mirroring prisma/seed.mjs posture):
//  1. DENY by default: SEED_TARGET must be exactly "scratch" (no DB contact
//     at all otherwise).
//  2. The target must be a LOCAL/isolated database (localhost / 127.0.0.1).
//     A remote host (Preview/Production) is refused unless the owner sets
//     BRAND_IMPORT_ALLOW_REMOTE=1 for that run.
//  3. --dry-run: prints the exact plan (creates / links / conflicts / invalid)
//     and writes NOTHING.
//  4. One transaction: brands + product links, or nothing.
//  5. Never re-points an existing link: a product that already carries a
//     DIFFERENT brand is reported as a CONFLICT and left untouched.
//  6. Unknown product ids and duplicate brand names are reported, not applied.
//  7. No DDL, no deletes, no business data beyond brands and brand links.
//
// USAGE:
//   SEED_TARGET=scratch node scripts/catalog/import-brands.mjs <approved.csv> [--dry-run]
// ============================================================================
import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

function fail(message) {
  process.stderr.write(`BRAND_IMPORT_DENIED: ${message}\n`);
  process.exit(1);
}

if (process.env.SEED_TARGET !== "scratch") {
  fail('SEED_TARGET must be exactly "scratch" (no database contact was made).');
}

const dsn = process.env.DATABASE_URL ?? "";
let parsed;
try {
  parsed = new URL(dsn);
} catch {
  fail("DATABASE_URL is missing or unparsable (no database contact was made).");
}
const host = parsed.hostname.toLowerCase();
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
if (!isLocal && process.env.BRAND_IMPORT_ALLOW_REMOTE !== "1") {
  fail(
    `target host "${host}" is not a local/isolated database. A shared Preview/Production ` +
      `database needs a separate explicit authorization (BRAND_IMPORT_ALLOW_REMOTE=1).`,
  );
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));
if (!file) fail("usage: import-brands.mjs <approved-mapping.csv> [--dry-run]");

function slugify(name) {
  return name.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase();
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const cells = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const header = cells(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const values = cells(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

const rows = parseCsv(readFileSync(file, "utf8")).filter((r) => (r.brand_name ?? "").length > 0);
if (rows.length === 0) fail("the mapping file has no usable rows.");

const db = new Client({ connectionString: dsn });
await db.connect();
const plan = { brands_to_create: [], links: [], conflicts: [], invalid_product_ids: [], duplicate_brand_names: [] };
try {
  const seenNames = new Set();
  for (const row of rows) {
    const brandName = row.brand_name;
    const slug = (row.slug ?? "").length > 0 ? row.slug : slugify(brandName);
    const ids = (row.product_ids ?? "").split("|").map((v) => v.trim()).filter(Boolean);
    if (seenNames.has(brandName.toLowerCase())) plan.duplicate_brand_names.push(brandName);
    seenNames.add(brandName.toLowerCase());
    const existingBrand = await db.query(
      "SELECT id::text AS id, name, slug FROM brands WHERE name = $1 OR slug = $2 LIMIT 1",
      [brandName, slug],
    );
    const brandId = existingBrand.rowCount > 0 ? existingBrand.rows[0].id : null;
    if (!brandId) plan.brands_to_create.push({ name: brandName, slug });
    for (const productId of ids) {
      if (!UUID_RE.test(productId)) {
        plan.invalid_product_ids.push(productId);
        continue;
      }
      const p = await db.query(
        "SELECT id::text AS id, name, brand_id::text AS brand_id FROM products WHERE id = $1::uuid",
        [productId],
      );
      if (p.rowCount === 0) { plan.invalid_product_ids.push(productId); continue; }
      const current = p.rows[0].brand_id;
      if (current && current !== brandId) {
        const other = await db.query("SELECT name FROM brands WHERE id = $1::uuid", [current]);
        plan.conflicts.push({
          product_id: productId,
          product_name: p.rows[0].name,
          current_brand: other.rows[0]?.name ?? current,
          requested_brand: brandName,
        });
        continue;
      }
      plan.links.push({ product_id: productId, product_name: p.rows[0].name, brand: brandName, brand_id: brandId });
    }
  }

  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    target: `${host}/${parsed.pathname.replace(/^\//, "")}`,
    brands_to_create: plan.brands_to_create.length,
    products_to_link: plan.links.length,
    conflicts_left_untouched: plan.conflicts.length,
    invalid_product_ids: plan.invalid_product_ids.length,
    duplicate_brand_names: plan.duplicate_brand_names.length,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (plan.conflicts.length > 0) process.stdout.write("conflicts:\n" + JSON.stringify(plan.conflicts, null, 2) + "\n");
  if (plan.invalid_product_ids.length > 0)
    process.stdout.write("invalid product ids:\n" + JSON.stringify(plan.invalid_product_ids, null, 2) + "\n");
  if (dryRun) {
    process.stdout.write("dry-run: nothing was written.\n");
    await db.end();
    process.exit(0);
  }

  let created = 0;
  let linked = 0;
  await db.query("BEGIN");
  try {
    for (const b of plan.brands_to_create) {
      await db.query(
        "INSERT INTO brands (id, name, slug, is_active, created_at, updated_at) VALUES ($1::uuid, $2, $3, TRUE, now(), now())",
        [randomUUID(), b.name, b.slug],
      );
      created++;
    }
    for (const l of plan.links) {
      const brand = await db.query("SELECT id::text AS id FROM brands WHERE name = $1 OR slug = $2 LIMIT 1", [l.brand, slugify(l.brand)]);
      if (brand.rowCount === 0) continue;
      const res = await db.query(
        "UPDATE products SET brand_id = $1::uuid, updated_at = now() WHERE id = $2::uuid AND brand_id IS NULL",
        [brand.rows[0].id, l.product_id],
      );
      linked += res.rowCount;
    }
    await db.query("COMMIT");
    process.stdout.write(JSON.stringify({ applied: true, brands_created: created, products_linked: linked }, null, 2) + "\n");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  }
} catch (err) {
  process.stderr.write(`BRAND_IMPORT_FAILED (rolled back): ${String(err.message).slice(0, 300)}\n`);
  process.exitCode = 1;
} finally {
  await db.end();
}
