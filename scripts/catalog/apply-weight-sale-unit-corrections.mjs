// ============================================================================
// PHASE 07 — WEIGHT sale-unit / product-type corrections (record-level)
// ============================================================================
// Applies the 14 source-backed corrections to the catalog. Every row was
// reconciled against the project's OWN import dataset and the POS price lists:
//
//   A) Hyper_Al_Moatasem_Final_Catalog.csv  (Final_Product_Dataset, 2026-10-17)
//      → per item: Sale_Type, Sale_Unit, Pack_Size/Pack_Unit, Sale_Price,
//        Price_Method/Price_Status/Price_Conflict, Unit_Method/Unit_Evidence.
//   B) Catalog_Reconciliation_Details.csv  (Critical_Findings_Closure, 2026-10-19)
//      → per barcode: sector price, general sale price, the applied action and
//        its class. All 14 rows are action=KEEP:
//          - 13 rows  class=BOTH_LISTS_AGREE      → the stored price is correct.
//          - 1 row    class=PRICE_IS_SECTOR_ONLY  → the stored price (17.00) is
//            the sectoral price; the general sale price (16.00) does not exist
//            for that barcode. The project's own reconciliation KEPT the
//            sectoral price, so NO price is changed here.
//
// WHAT IS CORRECTED (and why)
//  1. Eleven items are fixed PACKS in the source (Sale_Type=PIECE with a pack
//     size such as 290جم / 125جم / 20باك) but were imported as WEIGHT.
//     Corrected to product_type=PIECE, unit=PIECE, sale_step_grams=NULL
//     (required by chk_products_weight_rule). Their price and their variant
//     pack size/size_unit are preserved — the storefront then shows the pack
//     price and the pack detail, and the quantity is whole packs.
//  2. Three items are confirmed WEIGHT by the source (Sale_Type=WEIGHT) with a
//     kilogram retail price, but their variant carried no sale unit, which
//     makes them unpurchasable (the cart domain requires a sale unit for a
//     WEIGHT line: "Variant has no sale unit."). Their product row already
//     carries unit=KG (the catalog's own import field) and the source price is
//     a kilogram rate, so the variant sale unit is set to KG — the storefront
//     then applies the per-kilogram price contract and the approved purchase
//     weights (125 g … 1.25 kg).
//
// SAFETY
//  * Refuses to run unless CATALOG_CORRECTION_TARGET=local (an isolated
//    local database). A non-local host additionally requires
//    CATALOG_CORRECTION_ALLOW_REMOTE=1 — a shared Preview/Production write
//    is never performed by this script by default.
//  * One transaction; idempotent (already-correct rows are reported, not
//    rewritten); no DDL, no deletes, no price changes.
//  * --dry-run prints the exact per-record diff and writes nothing.
//  * Prints a per-record before/after report.
//
// USAGE
//   CATALOG_CORRECTION_TARGET=local node scripts/catalog/apply-weight-sale-unit-corrections.mjs [--dry-run]
// ============================================================================
import "dotenv/config";
import { Client } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");
const TARGET = process.env.CATALOG_CORRECTION_TARGET ?? "";
if (TARGET !== "local" && process.env.CATALOG_CORRECTION_ALLOW_REMOTE !== "1") {
  process.stderr.write(
    "CATALOG_CORRECTION_DENIED: set CATALOG_CORRECTION_TARGET=local (or explicitly " +
      "CATALOG_CORRECTION_ALLOW_REMOTE=1 for a separately authorized environment).\n",
  );
  process.exit(1);
}

const dsn = process.env.DATABASE_URL ?? "";
const host = (() => { try { return new URL(dsn).hostname.toLowerCase(); } catch { return ""; } })();
const localHost = ["localhost", "127.0.0.1", "::1"].includes(host);
if (!localHost && process.env.CATALOG_CORRECTION_ALLOW_REMOTE !== "1") {
  process.stderr.write(`CATALOG_CORRECTION_DENIED: target host "${host}" is not local.\n`);
  process.exit(1);
}

// barcode, product_id, variant_id, product_type, unit, sale_step_grams, variant_size_unit
const CORRECTIONS = [
  { n: 1, code: "6223000052648", product_id: "01a15042-1c48-75e5-8f95-6917a14c661c", variant_id: "01a15042-1ca5-7918-b505-9ef68c9628a6", name: "الرشيدى الميزان حلاوه 290جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 2, code: "6223000052518", product_id: "01a15040-b245-73de-a1ca-d79b6e559ede", variant_id: "01a15040-b2a5-791f-b4b8-c2a6a68755ea", name: "الرشيدى الميزان طحينه 125جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 3, code: "6223000052501", product_id: "01a15041-72ea-7f0f-bee3-01da7cd77bbb", variant_id: "01a15041-7346-7367-81b2-54ddfcbfc104", name: "الرشيدى الميزان طحينه 225جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 4, code: "6223000052525", product_id: "01a15041-f255-70b3-892a-19745ed12db6", variant_id: "01a15041-f2ad-7ffd-8d97-171d18c76661", name: "الرشيدى الميزان طحينه 450جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 5, code: "6223002555826", product_id: "01a15048-cb0e-7ca9-a6b0-80ce0ea38c88", variant_id: "01a15048-cb6e-75a6-848c-e931f347f2f3", name: "اوكسى 9نسيم الربيع كجم", product_type: "WEIGHT", unit: "KG", sale_step_grams: 125, variant_size_unit: "KG" },
  { n: 6, code: "6774446800626", product_id: "01a15051-5fa1-76e7-bc5b-cef4bbcfdd51", variant_id: "01a15051-5ff2-7b45-ada0-482c445ded27", name: "بابا صوص ثاوزند ايلاند285جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 7, code: "6222035220879", product_id: "01a1505c-cb06-7f23-9c7c-57798f532d8f", variant_id: "01a1505c-cb78-78de-b667-ab75af98aced", name: "بيج شيبسي جبنه بريميزان85جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 8, code: "6224001434686", product_id: "01a15054-a645-709d-93a6-51dd4ddc5f63", variant_id: "01a15054-a6a3-7808-b5a6-ed2fc6db529d", name: "جاردنيو صوص320جم بارميزان", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 9, code: "6223016575193", product_id: "01a15047-b2d0-76c4-8fa5-98a1c00a5911", variant_id: "01a15047-b32e-7bce-8cb6-d7c036cd26fe", name: "جبنه بيضا بالقشطة برو ميزان", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: null },
  { n: 10, code: "6223000750742", product_id: "01a15052-d7df-7f3b-9e0b-734bf484cbbe", variant_id: "01a15052-d83e-7185-902b-70ad05a429a6", name: "دومتي دوبل كريم 1 كيلو", product_type: "WEIGHT", unit: "KG", sale_step_grams: 125, variant_size_unit: "KG" },
  { n: 11, code: "6223014363419", product_id: "01a15050-d669-7151-97cd-c221c87c229c", variant_id: "01a15050-d6b2-7b79-8830-d81edb616897", name: "ديكسى ميلز ثاوزند ايلاند305جم", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
  { n: 12, code: "6040391212686", product_id: "01a15059-8f90-7322-ae66-c802fbfdcf9c", variant_id: "01a15059-8ff0-73fe-ad2b-c98e0606709f", name: "رويال ليمونوزنجبيل20باكت", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: null },
  { n: 13, code: "6223000521014", product_id: "01a15050-88e0-7bf4-89e9-1a247ab14ba3", variant_id: "01a15050-8945-7d19-9abb-1d35628a4c0a", name: "كفته اكجم جريت فودز", product_type: "WEIGHT", unit: "KG", sale_step_grams: 125, variant_size_unit: "KG" },
  { n: 14, code: "6223000414279", product_id: "01a1505d-840b-770b-8512-893a6bf17799", variant_id: "01a1505d-8462-7211-96b6-1e96dac6a792", name: "ليون زيزاج جبنه بارميزان ب10ج", product_type: "PIECE", unit: "PIECE", sale_step_grams: null, variant_size_unit: "GRAM" },
];

const db = new Client({ connectionString: dsn });
await db.connect();
let applied = 0;
let already = 0;
try {
  if (!DRY_RUN) await db.query("BEGIN");
  for (const c of CORRECTIONS) {
    const before = await db.query(
      `select p.product_type, p.unit, p.sale_step_grams, v.size_unit, v.price, p.name
         from products p join product_variants v on v.product_id = p.id
        where p.id = $1::uuid and v.id = $2::uuid`,
      [c.product_id, c.variant_id],
    );
    if (before.rowCount === 0) {
      process.stdout.write(`#${c.n} ${c.name}: RECORD NOT FOUND (skipped)\n`);
      continue;
    }
    const b = before.rows[0];
    const needsProduct =
      b.product_type !== c.product_type || b.unit !== c.unit || (b.sale_step_grams ?? null) !== (c.sale_step_grams ?? null);
    const needsVariant = (b.size_unit ?? null) !== (c.variant_size_unit ?? null);
    if (!needsProduct && !needsVariant) {
      already++;
      process.stdout.write(`#${c.n} ${c.name}: already correct (${b.product_type}/${b.unit}/step=${b.sale_step_grams}/vunit=${b.size_unit ?? "NULL"}) — no change\n`);
      continue;
    }
    if (DRY_RUN) {
      process.stdout.write(
        `#${c.n} ${c.name}: WOULD UPDATE ${b.product_type}/${b.unit}/step=${b.sale_step_grams}/vunit=${b.size_unit ?? "NULL"}` +
          `  ->  ${c.product_type}/${c.unit}/step=${c.sale_step_grams ?? "null"}/vunit=${c.variant_size_unit ?? "NULL"}` +
          `  (price untouched: ${b.price}; fields changed: ${[needsProduct ? "product_type/unit/sale_step_grams" : "", needsVariant ? "variant.size_unit" : ""].filter(Boolean).join(" + ") || "none"})\n`,
      );
      continue;
    }
    if (needsProduct) {
      await db.query(
        `update products set product_type = $1::varchar, unit = $2::varchar, sale_step_grams = $3::integer, updated_at = now() where id = $4::uuid`,
        [c.product_type, c.unit, c.sale_step_grams, c.product_id],
      );
    }
    if (needsVariant) {
      await db.query(`update product_variants set size_unit = $1::varchar, updated_at = now() where id = $2::uuid`, [
        c.variant_size_unit,
        c.variant_id,
      ]);
    }
    applied++;
    const after = await db.query(
      `select p.product_type, p.unit, p.sale_step_grams, v.size_unit, v.price
         from products p join product_variants v on v.product_id = p.id
        where p.id = $1::uuid and v.id = $2::uuid`,
      [c.product_id, c.variant_id],
    );
    const a = after.rows[0];
    process.stdout.write(
      `#${c.n} ${c.name}: ${b.product_type}/${b.unit}/step=${b.sale_step_grams}/vunit=${b.size_unit ?? "NULL"}` +
        `  ->  ${a.product_type}/${a.unit}/step=${a.sale_step_grams}/vunit=${a.size_unit ?? "NULL"}  (price unchanged: ${a.price})\n`,
    );
  }
  if (DRY_RUN) {
    process.stdout.write(`\nDRY-RUN: nothing was written. ${CORRECTIONS.length} records inspected.\n`);
  } else {
    await db.query("COMMIT");
    process.stdout.write(`\nAPPLIED ${applied}, ALREADY-CORRECT ${already}, TOTAL ${CORRECTIONS.length}\n`);
  }
} catch (e) {
  if (!DRY_RUN) await db.query("ROLLBACK").catch(() => {});
  process.stderr.write(`CORRECTION_FAILED (rolled back): ${String(e.message).slice(0, 300)}\n`);
  process.exitCode = 1;
} finally {
  await db.end();
}
