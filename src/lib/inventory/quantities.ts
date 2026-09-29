// BA-3 inventory quantity math (pure, no DB, no server-only).
//
// All stock arithmetic uses integer thousandths (NUMERIC(12,3) without
// floating point). Importable under plain-node tests via the BA-1
// ts-resolve hook; service.ts re-exports nothing from here implicitly.

/** Exact decimal-string -> integer thousandths (NUMERIC(12,3) without float).
 * "0.125" -> 125, "1" -> 1000, "47.350" -> 47350, "500.000" -> 500000. */
export function qtyToThousandths(s: string): number {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ""] = body.split(".");
  const frac = (fracRaw + "000").slice(0, 3);
  const value = Number(intPart) * 1000 + Number(frac);
  return neg ? -value : value;
}

/** PIECE lines count whole packs: thousandths must be a whole multiple. */
export function isWholePacks(qty: string): boolean {
  return qtyToThousandths(qty) % 1000 === 0;
}

/** WEIGHT requested quantities must be multiples of the product step.
 * KG: thousandths-of-KG ARE grams (0.125 KG = 125 thousandths = 125 g).
 * GRAM: thousandths are milligrams; step grams -> step*1000 thousandths. */
export function isStepMultiple(qty: string, saleStepGrams: number, sizeUnit: string | null): boolean {
  const t = qtyToThousandths(qty);
  if (sizeUnit === "GRAM") return t % (saleStepGrams * 1000) === 0;
  return t % saleStepGrams === 0; // KG (default) + NULL-safe fallback
}

/**
 * R7 fulfillment envelope (pure, integer math, no float):
 * commit ⟺ actual ≤ requested + tolerance, tolerance WEIGHT = MAX(1 step
 * in unit, 10% requested), PIECE = 0. All comparisons in thousandths with
 * the 10% handled by ×10 cross-multiplication (exact).
 */
export function envelopeAllows(
  requested: string,
  actual: string,
  productType: string,
  saleStepGrams: number | null,
  sizeUnit: string | null,
): boolean {
  const req = qtyToThousandths(requested);
  const act = qtyToThousandths(actual);
  if (productType !== "WEIGHT") return act <= req; // PIECE tolerance 0
  const step = saleStepGrams ?? 0;
  const stepThousandths = sizeUnit === "GRAM" ? step * 1000 : step;
  // act ≤ req + max(step, req/10)  ⟺  10*act ≤ 10*req + max(10*step, req)
  return 10 * act <= 10 * req + Math.max(10 * stepThousandths, req);
}
