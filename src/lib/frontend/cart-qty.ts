// FE-4 cart quantity helpers (pure, client-safe): mirror the server wire rules for
// pre-send UX validation ONLY. The backend re-validates everything authoritatively.
// PIECE: whole packs ("2"). WEIGHT KG: decimal kg ("0.5"); WEIGHT GRAM: integer grams ("500").
//
// Phase 07 (owner decision D01): the price of a WEIGHT product is the price of ONE
// KILOGRAM, so a chosen weight is priced as `price/kg × grams / 1000` — grams are
// never multiplied by a per-kg price. PIECE (and any product whose catalog price is a
// pack price) keeps its pack price: it is never divided by a weight and never shown
// as a price-per-gram/per-kg.

/**
 * How a product's price is expressed (Phase 07 D01).
 * - `PER_KG`: WEIGHT sold in kilograms — the contract's price for this sale type is
 *   the price of one kilogram, and the line estimate scales with the chosen weight.
 * - `PACK`: the price is the price of the sold unit/pack — displayed as-is, never
 *   converted into a per-gram or per-kg figure.
 *
 * A WEIGHT row whose variant unit is not KG keeps the catalog's pack price and is
 * reported for independent data correction (D01 rule 9) instead of being reinterpreted.
 */
export type SaleBasis = "PER_KG" | "PACK";

export function saleBasisFor(productType: string, variantSizeUnit: string | null): SaleBasis {
  return productType === "WEIGHT" && variantSizeUnit === "KG" ? "PER_KG" : "PACK";
}

/** Convert chosen grams to the API quantity string for the variant's sizeUnit. */
export function gramsToQtyText(sizeUnit: string | null, grams: number): string | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  if (sizeUnit === "KG") {
    const kg = grams / 1000;
    return String(Math.round(kg * 1000) / 1000);
  }
  if (sizeUnit === "GRAM") {
    if (!Number.isInteger(grams)) return null;
    return String(grams);
  }
  return null;
}

/** True when grams satisfy the product step ( UX pre-check; server decides). */
export function isStepValid(grams: number, saleStepGrams: number | null): boolean {
  if (!Number.isFinite(grams) || grams <= 0) return false;
  if (saleStepGrams === null || saleStepGrams <= 0) return false;
  return grams % saleStepGrams === 0;
}

/** True for whole-pack counts (PIECE pre-check). */
export function isWholePacks(qty: number): boolean {
  return Number.isInteger(qty) && qty > 0;
}

/** Display-only line estimate in piastres (integer math; NEVER authoritative). */
export function estimatePiastres(qtyText: string, unitPrice: string): number | null {
  const qty = Number(qtyText);
  const price = Number(unitPrice);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) return null;
  return Math.round(qty * price * 100);
}

/**
 * Weight line estimate in piastres for a PER-KILOGRAM price (Phase 07 D01):
 * `price per kg × chosen grams / 1000`.
 *
 * Integer math only: the price is converted to piastres once (2dp) and the
 * multiplication happens in integers, so no floating-point error can reach the
 * displayed amount. Rounding is half-up to the nearest piastre — the same policy
 * the backend applies with `ROUND(qty × price, 2)` in `lib/cart/totals.ts`
 * (33.00/kg × 125 g → 4.13 EGP; × 500 g → 16.50 EGP).
 */
export function weightEstimatePiastres(pricePerKg: string, grams: number): number | null {
  const price = Number(pricePerKg);
  if (!Number.isFinite(price) || price < 0) return null;
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const piastres = Math.round(price * 100);
  return Math.round((piastres * grams) / 1000);
}

/** Canonical weight purchase list in grams (Phase 07 D04 — owner approved):
 * 125 g · 250 g · 500 g · 1 kg · 1.25 kg. Callers filter it by the product's
 * own sale step (`isStepValid`) so a product is never offered an invalid weight. */
export const WEIGHT_PRESETS_GRAMS = [125, 250, 500, 1000, 1250];
