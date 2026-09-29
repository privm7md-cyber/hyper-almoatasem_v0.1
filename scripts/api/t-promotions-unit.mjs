// BA-8 promotions unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-promotions-unit.mjs
// Covers: exact integer math (divRound/parse), targeting + OR + specificity,
// thresholds, stacking gate, sequential compounding, caps, BXGY sets,
// FIXED_PRICE clamp, pro-rata allocation with dust, status/type enums,
// boundary shapes (strict, code normalization, no invented states).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ divRoundHalfAway, parseScaled, matchLine, evaluateLines, evaluateOrderLayer, allocate }] = await Promise.all([
  import("../../src/lib/promotions/engine.ts"),
]);
const validation = await import("../../src/lib/promotions/validation.ts");
const { orderLockIds } = await import("../../src/lib/api/concurrency.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "promotions-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const sub = () => false;
const P = (over) => ({
  id: "p", type: "PERCENTAGE", scope: "LINE", priority: 0, isStackable: false,
  createdAt: "2026-01-01T00:00:00.000Z", targets: [], discountPercentH: 2000,
  discountAmountC: null, fixedPriceC: null, minimumQuantityT: null, minimumAmountC: null,
  maximumDiscountC: null, buyQtyT: null, getQtyT: null, buyPctH: null, freeVariantId: null,
  usageLimit: null, inSubtree: sub, ...over,
});
const L = (over) => ({
  key: "l", ctx: { vid: "v", pid: "p", bid: null, cid: "c", pt: "PIECE", pu: "PIECE", su: null },
  qtyT: 2000, grossC: 3000, netC: 3000, unitPriceC: 1500, ...over,
});

// --- exact math ---
t("divround-half-away", divRoundHalfAway(4166625, 1000) === 4167 && divRoundHalfAway(500, 1000) === 1
  && divRoundHalfAway(499, 1000) === 0 && divRoundHalfAway(0, 1000) === 0);
t("parse-scaled", parseScaled("12.50", 2) === 1250 && parseScaled("0.125", 3) === 125
  && parseScaled("500", 3) === 500000 && parseScaled("20.00", 2) === 2000);

// --- targeting ---
t("match-variant", matchLine(L({ ctx: { vid: "v", pid: "p", bid: null, cid: "c", pt: "PIECE", pu: "PIECE", su: null } }).ctx,
  P({ targets: [{ tt: "VARIANT", tid: "v" }] })) === 4);
t("match-or-best", matchLine(L().ctx, P({ targets: [{ tt: "BRAND", tid: "b" }, { tt: "VARIANT", tid: "v" }] })) === 4);
t("match-miss", matchLine(L().ctx, P({ targets: [{ tt: "VARIANT", tid: "other" }] })) === 0);
t("match-brand-null-safe", matchLine(L().ctx, P({ targets: [{ tt: "BRAND", tid: "b" }] })) === 0);
t("match-subtree", matchLine(L({ ctx: { vid: "v", pid: "p", bid: null, cid: "child", pt: "PIECE", pu: "PIECE", su: null } }).ctx,
  { ...P({ targets: [{ tt: "CATEGORY", tid: "root" }] }), inSubtree: (a, b) => a === "child" && b === "root" }) === 1);

// --- line evaluation: percent + stacking + caps ---
t("percent-line", (() => {
  const lines = [L({ key: "a", qtyT: 2000, grossC: 3000, netC: 3000, unitPriceC: 1500 })];
  const { rows } = evaluateLines(lines, [P({ id: "p1", targets: [{ tt: "VARIANT", tid: "v" }] })]);
  return rows.length === 1 && rows[0].amountC === 600 && lines[0].netC === 2400;
})());
t("stack-exclusive", (() => {
  const lines = [L({ key: "a", grossC: 3000, netC: 3000 })];
  const a = P({ id: "a", priority: 10, isStackable: false, discountPercentH: 2000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const b = P({ id: "b", priority: 1, isStackable: true, discountPercentH: 500, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [a, b]);
  return rows.length === 1 && rows[0].amountC === 600 && lines[0].netC === 2400;
})());
t("stack-sequential", (() => {
  const lines = [L({ key: "a", grossC: 3000, netC: 3000 })];
  const a = P({ id: "a", priority: 10, isStackable: true, discountPercentH: 2000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const b = P({ id: "b", priority: 1, isStackable: true, discountPercentH: 1000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [a, b]);
  const total = rows.reduce((s, r) => s + r.amountC, 0);
  return rows.length === 2 && total === 840 && lines[0].netC === 2160;
})());
t("stack-gate-mixed", (() => {
  const lines = [L({ key: "a", grossC: 3000, netC: 3000 })];
  const a = P({ id: "a", priority: 10, isStackable: false, discountPercentH: 2000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const b = P({ id: "b", priority: 1, isStackable: true, discountPercentH: 2000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [a, b]);
  return rows.length === 1;
})());
t("priority-order", (() => {
  const lines = [L({ key: "a", grossC: 10000, netC: 10000 })];
  const lo = P({ id: "lo", priority: 1, isStackable: true, discountPercentH: 5000, createdAt: "2026-01-02T00:00:00.000Z", targets: [{ tt: "VARIANT", tid: "v" }] });
  const hi = P({ id: "hi", priority: 9, isStackable: true, discountPercentH: 1000, createdAt: "2026-01-01T00:00:00.000Z", targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [lo, hi]);
  return rows.length === 2 && rows[0].promo.id === "hi" && rows[0].amountC === 1000 && rows[1].amountC === 4500;
})());
t("specificity-order", (() => {
  const lines = [L({ key: "a", grossC: 10000, netC: 10000, ctx: { vid: "v", pid: "p", bid: "b", cid: "c", pt: "PIECE", pu: "PIECE", su: null } })];
  const brand = P({ id: "br", priority: 5, isStackable: true, discountPercentH: 1000, targets: [{ tt: "BRAND", tid: "b" }] });
  const variant = P({ id: "va", priority: 5, isStackable: true, discountPercentH: 2000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [brand, variant]);
  return rows.length === 2 && rows[0].promo.id === "va";
})());
t("cap-pins-total", (() => {
  const lines = [L({ key: "a", grossC: 10000, netC: 10000 }), L({ key: "b", grossC: 10000, netC: 10000 })];
  const p = P({ id: "c", priority: 5, isStackable: true, discountPercentH: 5000, maximumDiscountC: 3000, targets: [{ tt: "VARIANT", tid: "v" }] });
  lines[1].ctx = { ...lines[1].ctx, vid: "v" };
  const { rows } = evaluateLines(lines, [p]);
  return rows.reduce((s, r) => s + r.amountC, 0) === 3000;
})());
t("fixed-clamped", (() => {
  const lines = [L({ key: "a", grossC: 3000, netC: 3000 })];
  const p = P({ id: "f", type: "FIXED_AMOUNT", discountPercentH: null, discountAmountC: 5000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [p]);
  return rows.length === 1 && rows[0].amountC === 3000;
})());
t("fixed-price-skip", (() => {
  const lines = [L({ key: "a", qtyT: 1000, grossC: 1500, netC: 1500, unitPriceC: 1500 })];
  const p = P({ id: "fp", type: "FIXED_PRICE", discountPercentH: null, fixedPriceC: 1500, targets: [{ tt: "VARIANT", tid: "v" }] });
  return evaluateLines(lines, [p]).rows.length === 0;
})());
t("fixed-price-benefit", (() => {
  const lines = [L({ key: "a", qtyT: 2000, grossC: 3000, netC: 3000, unitPriceC: 1500 })];
  const p = P({ id: "fp", type: "FIXED_PRICE", discountPercentH: null, fixedPriceC: 1000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [p]);
  return rows.length === 1 && rows[0].amountC === 1000;
})());
t("bxgy-sets", (() => {
  const lines = [L({ key: "a", qtyT: 5000, grossC: 7500, netC: 7500, unitPriceC: 1500 })];
  const p = P({ id: "bx", type: "BUY_X_GET_Y", discountPercentH: null, buyQtyT: 2000, getQtyT: 1000, buyPctH: 10000, freeVariantId: null, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [p]);
  return rows.length === 1 && rows[0].amountC === 3000 && rows[0].freeQtyT === 2000;
})());
t("bxgy-remainder", (() => {
  const lines = [L({ key: "a", qtyT: 1200, grossC: 38400, netC: 38400, unitPriceC: 32000 })];
  const p = P({ id: "bx", type: "BUY_X_GET_Y", discountPercentH: null, buyQtyT: 500, getQtyT: 100, buyPctH: 10000, freeVariantId: null, targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [p]);
  return rows.length === 1 && rows[0].freeQtyT === 200;
})());
t("bxgy-cross-spec", (() => {
  const lines = [L({ key: "a", qtyT: 2000, grossC: 3000, netC: 3000, unitPriceC: 1500 })];
  const p = P({ id: "bx", type: "BUY_X_GET_Y", discountPercentH: null, buyQtyT: 2000, getQtyT: 1000, buyPctH: 10000, freeVariantId: "free-v", targets: [{ tt: "VARIANT", tid: "v" }] });
  const { rows } = evaluateLines(lines, [p]);
  return rows.length === 1 && rows[0].amountC === 0 && rows[0].freeLine.variantId === "free-v" && lines[0].netC === 3000;
})());
t("thresholds", (() => {
  const lines = [L({ key: "a", qtyT: 1000, grossC: 1500, netC: 1500 })];
  const q = P({ id: "q", minimumQuantityT: 2000, targets: [{ tt: "VARIANT", tid: "v" }] });
  const m = P({ id: "m", minimumAmountC: 1000, targets: [{ tt: "VARIANT", tid: "v" }] });
  return evaluateLines(lines, [q]).rows.length === 0 && evaluateLines(lines, [m]).rows.length === 1;
})());
t("order-layer", (() => {
  const lines = [L({ key: "a", grossC: 20000, netC: 18000 }), L({ key: "b", grossC: 10000, netC: 10000 })];
  const p = P({ id: "o", scope: "ORDER", discountPercentH: 1000, targets: [] });
  const { rows, grossAllC } = evaluateOrderLayer(lines, [p]);
  return grossAllC === 30000 && rows.length === 1 && rows[0].amountC === 2800 && rows[0].baseC === 28000;
})());
t("order-minimum-gross", (() => {
  const lines = [L({ key: "a", grossC: 1500, netC: 1500 })];
  const p = P({ id: "o", scope: "ORDER", minimumAmountC: 20000, targets: [] });
  return evaluateOrderLayer(lines, [p]).rows.length === 0;
})());
t("allocate-exact", (() => {
  const out = allocate(1000, [{ id: "b", netC: 7000 }, { id: "a", netC: 3000 }]);
  const sum = out.reduce((s, x) => s + x.amountC, 0);
  return sum === 1000 && out.find((x) => x.id === "a").amountC === 300 && out.find((x) => x.id === "b").amountC === 700;
})());
t("allocate-dust", (() => {
  const out = allocate(100, [{ id: "x", netC: 1 }, { id: "y", netC: 1 }, { id: "z", netC: 1 }]);
  const sum = out.reduce((s, x) => s + x.amountC, 0);
  return sum === 100 && out.find((x) => x.id === "x").amountC === 34;
})());
t("allocate-zero", allocate(0, [{ id: "a", netC: 5 }])[0].amountC === 0);

// --- boundaries ---
const { promotionInputSchema, promotionStatusSchema, targetTypeSchema, couponInputSchema, estimateInputSchema } = validation;
t("promo-shape", promotionInputSchema.safeParse({ name: "X", type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00" }).success);
t("promo-shape-permissive-values", promotionInputSchema.safeParse({ name: "X", type: "PERCENTAGE", scope: "LINE" }).success);
t("promo-rejects", !promotionInputSchema.safeParse({ name: "X", type: "BOGUS", scope: "LINE", discountPercent: "10" }).success
  && !promotionInputSchema.safeParse({ name: "X", type: "PERCENTAGE", scope: "LINE", discountPercent: "10.00", extra: 1 }).success
  && !promotionInputSchema.safeParse({ name: "X", type: "PERCENTAGE", scope: "LINE", discountPercent: "150" }).success);
t("status-enum", promotionStatusSchema.safeParse("ACTIVE").success && !promotionStatusSchema.safeParse("EXPIRED").success);
t("target-enum", targetTypeSchema.safeParse("CATEGORY").success && !targetTypeSchema.safeParse("STORE").success);
t("coupon-shape", couponInputSchema.safeParse({ promotionId: "04800000-0000-7000-8000-000000000001", code: "SAVE10" }).success
  && !couponInputSchema.safeParse({ promotionId: "04800000-0000-7000-8000-000000000001" }).success);
t("estimate-shape", estimateInputSchema.safeParse({ lines: [{ productVariantId: "04800000-0000-7000-8000-000000000001", quantity: "2" }], couponCode: "save10" }).success
  && !estimateInputSchema.safeParse({ lines: [] }).success
  && !estimateInputSchema.safeParse({ lines: [{ productVariantId: "04800000-0000-7000-8000-000000000001", quantity: "0" }] }).success);
t("lock-order-asc", JSON.stringify(orderLockIds(["b", "a"])) === JSON.stringify(["a", "b"]));

done();
