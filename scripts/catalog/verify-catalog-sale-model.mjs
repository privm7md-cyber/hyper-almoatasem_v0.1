// ============================================================================
// CATALOG SALE-MODEL VALIDATOR (read-only) — Phase 07
//
// Guards the invariants that the storefront's price/unit contract depends on:
//   * a WEIGHT product's sellable variant must carry a sale unit — the cart
//     domain counts WEIGHT lines in the variant's live unit and rejects a
//     missing one ("Variant has no sale unit."), so a NULL unit makes the
//     product unpurchasable;
//   * a PIECE product must have unit=PIECE and NO sale step (mirrors
//     chk_products_weight_rule);
//   * a WEIGHT product priced per kilogram must not carry a pack-sized
//     (GRAM) variant unit — that combination is a pack price presented as a
//     per-kg price.
//
// Usage (read-only, no writes):
//   CATALOG_CORRECTION_TARGET=local node scripts/catalog/verify-catalog-sale-model.mjs
// ============================================================================
import "dotenv/config";
import { Client } from "pg";

const TARGET = process.env.CATALOG_CORRECTION_TARGET ?? "";
const dsn = process.env.DATABASE_URL ?? "";
if (TARGET !== "local" && process.env.CATALOG_CORRECTION_ALLOW_REMOTE !== "1") {
  const host = (() => { try { return new URL(dsn).hostname.toLowerCase(); } catch { return "?"; } })();
  process.stderr.write(`CATALOG_VERIFY_DENIED: target host "${host}" is not an approved local surface (set CATALOG_CORRECTION_TARGET=local).\n`);
  process.exit(1);
}

const CHECKS = [
  [
    "WEIGHT product without a variant sale unit (unpurchasable)",
    `select count(*)::int n from products p join product_variants v on v.product_id = p.id
      where p.product_type='WEIGHT' and p.is_active and p.deleted_at is null
        and v.is_active and v.deleted_at is null and v.size_unit is null`,
  ],
  [
    "PIECE product with a sale step (must be NULL)",
    `select count(*)::int n from products where product_type='PIECE' and sale_step_grams is not null`,
  ],
  [
    "WEIGHT product with unit outside KG/GRAM",
    `select count(*)::int n from products where product_type='WEIGHT' and unit not in ('KG','GRAM')`,
  ],
  [
    "PIECE product whose unit is not PIECE",
    `select count(*)::int n from products where product_type='PIECE' and unit <> 'PIECE'`,
  ],
  [
    "WEIGHT product with a pack-sized (GRAM) variant unit — pack price under a per-kg label",
    `select count(*)::int n from products p join product_variants v on v.product_id = p.id
      where p.product_type='WEIGHT' and p.is_active and v.is_active and v.size_unit='GRAM'`,
  ],
];

const db = new Client({ connectionString: dsn });
await db.connect();
let violations = 0;
for (const [label, sql] of CHECKS) {
  const r = await db.query(sql);
  const n = r.rows[0].n;
  if (n > 0) violations++;
  process.stdout.write(`${n > 0 ? "VIOLATION" : "OK      "} (${n}) ${label}\n`);
}
process.stdout.write(`\ntotal violations: ${violations}\n`);
await db.end();
process.exit(violations === 0 ? 0 : 1);
