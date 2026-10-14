// FE-4 cart quantity helpers (pure, client-safe): mirror the server wire rules for
// pre-send UX validation ONLY. The backend re-validates everything authoritatively.
// PIECE: whole packs ("2"). WEIGHT KG: decimal kg ("0.5"); WEIGHT GRAM: integer grams ("500").

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

/** Canonical weight presets (g); callers filter by isStepValid per product. */
export const WEIGHT_PRESETS_GRAMS = [125, 250, 500, 1000, 1250];
