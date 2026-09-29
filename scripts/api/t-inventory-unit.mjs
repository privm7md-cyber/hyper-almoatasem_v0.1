// BA-3 inventory unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-inventory-unit.mjs
// Covers: integer-thousandths math (no float), step multiples, piece packs,
// R7 envelope cases (frozen W1-W7 vectors), Zod boundary shapes.
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ qtyToThousandths, isWholePacks, isStepMultiple, envelopeAllows }] = await Promise.all([
  import("../../src/lib/inventory/quantities.ts"),
]);
const validation = await import("../../src/lib/inventory/validation.ts");
const { orderLockIds } = await import("../../src/lib/api/concurrency.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "inventory-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

// --- thousandths (exact, no float) ---
t("thousandths-0.125", qtyToThousandths("0.125") === 125);
t("thousandths-1", qtyToThousandths("1") === 1000);
t("thousandths-47.350", qtyToThousandths("47.350") === 47350);
t("thousandths-500", qtyToThousandths("500.000") === 500000);
t("thousandths-neg", qtyToThousandths("-0.475") === -475);
t("thousandths-no-float-dust", qtyToThousandths("0.1") + qtyToThousandths("0.2") === 300);

// --- piece packs ---
t("piece-whole-ok", isWholePacks("2") && isWholePacks("2.000") && isWholePacks("10"));
t("piece-fraction-no", !isWholePacks("0.5") && !isWholePacks("2.500") && !isWholePacks("0.001"));

// --- weight steps (125g KG basis) ---
t("step-multiples-ok", isStepMultiple("0.125", 125, "KG") && isStepMultiple("0.250", 125, "KG") && isStepMultiple("0.500", 125, "KG") && isStepMultiple("1.000", 125, "KG"));
t("step-violation-no", !isStepMultiple("0.100", 125, "KG") && !isStepMultiple("0.475", 125, "KG") && !isStepMultiple("0.001", 125, "KG"));
t("step-gram-basis", isStepMultiple("125", 125, "GRAM") && !isStepMultiple("100", 125, "GRAM"));

// --- R7 envelope (frozen W vectors: req 0.500 step 125 KG) ---
t("envelope-W1-under", envelopeAllows("0.500", "0.475", "WEIGHT", 125, "KG") === true);
t("envelope-W2-exact", envelopeAllows("0.500", "0.500", "WEIGHT", 125, "KG") === true);
t("envelope-W3-tol-over", envelopeAllows("0.500", "0.525", "WEIGHT", 125, "KG") === true);
t("envelope-W4-reject", envelopeAllows("0.500", "0.650", "WEIGHT", 125, "KG") === false);
t("envelope-W6-piece-zero", envelopeAllows("10", "11", "PIECE", null, "PIECE") === false);
t("envelope-W6-piece-under", envelopeAllows("10", "9", "PIECE", null, "PIECE") === true);
t("envelope-piece-exact", envelopeAllows("10", "10", "PIECE", null, "PIECE") === true);
t("envelope-10pct-branch", envelopeAllows("2.000", "2.150", "WEIGHT", 125, "KG") === true
  && envelopeAllows("2.000", "2.300", "WEIGHT", 125, "KG") === false);

// --- deterministic lock order ---
t("lock-order-asc", JSON.stringify(orderLockIds(["b", "a", "b", "c"])) === JSON.stringify(["a", "b", "c"]));

// --- boundary schemas ---
const { positiveQtySchema, signedQtySchema, adjustInputSchema, reserveInputSchema, commitInputSchema, inventoryListQuerySchema, thresholdPatchSchema } = validation;
t("qty-wire-ok", positiveQtySchema.safeParse("0.125").success && positiveQtySchema.safeParse("500").success);
t("qty-wire-no", !positiveQtySchema.safeParse("0").success && !positiveQtySchema.safeParse("-1").success
  && !positiveQtySchema.safeParse("0.1234").success && !positiveQtySchema.safeParse("abc").success
  && !positiveQtySchema.safeParse(0.125).success);
t("delta-wire-ok", signedQtySchema.safeParse("5.000").success && signedQtySchema.safeParse("-44.850").success);
t("delta-wire-no", !signedQtySchema.safeParse("0").success && !signedQtySchema.safeParse("0.000").success);
t("adjust-rejects-sale-type", !adjustInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", delta: "1.000", movementType: "SALE" }).success);
t("adjust-rejects-cancelled-type", !adjustInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", delta: "1.000", movementType: "CANCELLED_ORDER" }).success);
t("adjust-rejects-replacement-type", !adjustInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", delta: "1.000", movementType: "REPLACEMENT" }).success);
t("adjust-accepts-manual-types", ["STOCK_IN", "ADJUSTMENT", "WASTE", "RETURN"].every((mt) =>
  adjustInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", delta: "1.000", movementType: mt }).success));
t("adjust-ref-pair-rule", !adjustInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", delta: "1.000", movementType: "STOCK_IN", referenceId: "PO-1" }).success);
t("adjust-strict-unknown", !adjustInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", delta: "1.000", movementType: "STOCK_IN", hacked: 1 }).success);
t("reserve-strict", reserveInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", quantity: "0.500" }).success
  && !reserveInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", quantity: "0.500", extra: 1 }).success);
t("commit-strict", commitInputSchema.safeParse({ productVariantId: "02800000-0000-7000-8000-000000000001", requested: "0.500", actual: "0.475" }).success);
t("threshold-nullable", thresholdPatchSchema.safeParse({ lowStockThreshold: null }).success
  && thresholdPatchSchema.safeParse({ lowStockThreshold: "5.000" }).success
  && !thresholdPatchSchema.safeParse({ lowStockThreshold: "-1" }).success
  && !thresholdPatchSchema.safeParse({}).success);
t("list-query-bool-explicit", (() => {
  const ok = inventoryListQuerySchema.safeParse({ inStock: "true", lowStock: "false" });
  const bad = inventoryListQuerySchema.safeParse({ inStock: true });
  return ok.success && !bad.success;
})());

done();
