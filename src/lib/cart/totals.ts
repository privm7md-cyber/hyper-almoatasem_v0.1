// BA-5 cart totals (pure, no DB, no server-only).
//
// Money math WITHOUT floating point: quantities as integer thousandths
// (NUMERIC(12,3), reused from the BA-3 utilities), prices as integer
// piastres (NUMERIC(10,2)). Line total mirrors the frozen order-item rule
// `estimated_total = ROUND(qty × price, 2)` — integer-exact for realistic
// magnitudes (exact halves always round correctly; non-boundary values sit
// ≥0.001 from any rounding edge, far above float error).
// Cart subtotals are INFORMATIONAL (the carts table stores no totals;
// authoritative money is computed at checkout in BA-6).
// Importable under plain-node tests (relative imports only).

/** Exact decimal-string -> integer thousandths (local copy of the BA-3
 * rule — previous BA modules are not modified for reuse). */
export function qtyToThousandths(s: string): number {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ""] = body.split(".");
  const frac = (fracRaw + "000").slice(0, 3);
  const value = Number(intPart) * 1000 + Number(frac);
  return neg ? -value : value;
}

/** Exact decimal-string (≤2dp) -> integer piastres. "15.00" -> 1500. */
export function priceToPiastres(s: string): number {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracRaw = ""] = body.split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  const value = Number(intPart) * 100 + Number(frac);
  return neg ? -value : value;
}

/** ROUND(qty × price, 2) in piastres. qty: NUMERIC(12,3) text; price:
 * NUMERIC(10,2) text. Returns null when the line has no price snapshot
 * (unpriced lines contribute nothing — never invent a price). */
export function lineTotalPiastres(quantity: string, unitPrice: string | null): number | null {
  if (unitPrice === null) return null;
  return Math.round((qtyToThousandths(quantity) * priceToPiastres(unitPrice)) / 1000);
}

/** Sum of priced lines, in piastres. */
export function cartSubtotalPiastres(lines: Array<{ quantity: string; unitPrice: string | null }>): number {
  let sum = 0;
  for (const l of lines) {
    const t = lineTotalPiastres(l.quantity, l.unitPrice);
    if (t !== null) sum += t;
  }
  return sum;
}

/** Piastres -> "EGP" display string with exactly 2 decimals. */
export function formatPiastres(piastres: number): string {
  const sign = piastres < 0 ? "-" : "";
  const abs = Math.abs(piastres);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
