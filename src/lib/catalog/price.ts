// Exact decimal helpers for selling prices (PURE — no Prisma, no floats).
//
// The price column is `NUMERIC(10,2)`: two approved fraction digits. Money
// comparison must never go through JavaScript floating point (0.1 + 0.2 style
// drift), so every comparison here is done on the DECIMAL TEXT.
//
// Two problems this module exists to solve:
//   1. `15` and `15.00` are the same price but different strings. A text
//      comparison says "different" and the write path then tries to record a
//      price-history row with old_price = new_price, which the frozen CHECK
//      `chk_price_history_changed` rejects -> HTTP 500 (Phase-10 G02).
//   2. A value with a third fraction digit that is not representable at the
//      approved precision (`15.005`) must be REJECTED, never silently
//      rounded to `15.01`.
//
// The canonical form is the exact value with trailing zeros removed
// ("15.000" -> "15", "15.50" -> "15.5", "0.00" -> "0").

/** The approved price precision (NUMERIC(10,2)). */
export const PRICE_SCALE = 2;

const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;

/**
 * The canonical text of a non-negative decimal, or null when the input is
 * not a plain decimal. Exact: no float ever touches the value.
 */
export function canonicalDecimal(text: string): string | null {
  const match = DECIMAL_TEXT.exec(text.trim());
  if (!match) return null;
  const whole = match[1];
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > PRICE_SCALE) return null; // beyond the approved precision
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * True when both texts denote the SAME exact decimal value.
 * "15" == "15.00" == "15.000"; "15.005" is rejected (not equal, not valid).
 */
export function decimalsEqual(a: string, b: string): boolean {
  const left = canonicalDecimal(a);
  const right = canonicalDecimal(b);
  if (left === null || right === null) return false;
  return left === right;
}

/**
 * True when the text is a valid price for the approved precision: a plain
 * non-negative decimal whose value is exactly representable at 2 fraction
 * digits ("15", "15.00", "15.000" are valid; "15.005" is not).
 */
export function isValidPriceText(text: string): boolean {
  return canonicalDecimal(text) !== null;
}
