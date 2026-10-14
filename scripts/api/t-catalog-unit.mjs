// BA-2 catalog unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-catalog-unit.mjs
// Covers (L3 Direction A): product sale-unit boundary accepts exactly
// PIECE/KG/GRAM and rejects LITER/ML (400-class at the route boundary);
// variant package-size metadata still accepts the full size-unit set;
// weight-shape domain rule expectations preserved (WEIGHT+PIECE still
// reaches the domain rule, not the boundary).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const validation = await import("../../src/lib/catalog/validation.ts");
const { productInputSchema, productUnitSchema, sizeUnitSchema, variantInputSchema } = validation;

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "catalog-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((f) => f.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const CAT = "02800000-0000-7000-8000-000000000001";
const base = { name: "Probe", categoryId: CAT, productType: "PIECE", unit: "PIECE" };

// --- product sale-unit boundary (Direction A: closed PIECE/KG/GRAM) ---
t("unit-piece-accepted", productUnitSchema.safeParse("PIECE").success);
t("unit-kg-accepted", productUnitSchema.safeParse("KG").success);
t("unit-gram-accepted", productUnitSchema.safeParse("GRAM").success);
t("unit-liter-rejected", !productUnitSchema.safeParse("LITER").success);
t("unit-ml-rejected", !productUnitSchema.safeParse("ML").success);
t("unit-empty-rejected", !productUnitSchema.safeParse("").success);
t("unit-lowercase-rejected", !productUnitSchema.safeParse("kg").success);
t("create-liter-400-class", !productInputSchema.safeParse({ ...base, unit: "LITER" }).success);
t("create-ml-400-class", !productInputSchema.safeParse({ ...base, unit: "ML" }).success);
t("create-kg-weight-accepted", productInputSchema.safeParse({ ...base, productType: "WEIGHT", unit: "KG", saleStepGrams: 250 }).success);
// WEIGHT+PIECE still passes the boundary (domain weight rule owns the 422).
t("create-weight-piece-passes-boundary", productInputSchema.safeParse({ ...base, productType: "WEIGHT", unit: "PIECE" }).success);
// Invalid productType stays boundary-rejected (400-class consistency).
t("create-bad-type-rejected", !productInputSchema.safeParse({ ...base, productType: "VOLUME", unit: "KG" }).success);

// --- variant package-size metadata untouched (LITER/ML still valid) ---
t("size-liter-accepted", sizeUnitSchema.safeParse("LITER").success);
t("size-ml-accepted", sizeUnitSchema.safeParse("ML").success);
t("variant-ml-size-accepted", variantInputSchema.safeParse({ productId: CAT, name: "Can 330", sizeValue: "0.330", sizeUnit: "ML", price: "30.00" }).success);
t("variant-kg-size-accepted", variantInputSchema.safeParse({ productId: CAT, name: "Bag", sizeValue: "1", sizeUnit: "KG", price: "100.00" }).success);

done();
