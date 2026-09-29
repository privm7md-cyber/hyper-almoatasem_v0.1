// BA-4 customer phone normalization (pure, no DB, no server-only).
//
// Frozen R8 ladder (phase2-architecture-proposal Appendix R2 + the exact
// reference implementation in db/tests/run-tests.js `normalizePhone`):
//   RAW → strip non-digits → 00-drop → 0→20 (len 11) / prepend-20 (len 10,
//   leading 1) / keep (len 12, leading 20) / else REJECT → identity gate
//   ^201[0125][0-9]{8}$ (Egyptian mobiles only: 010/011/012/015).
// The database CHECK (^[0-9]{8,15}$ + UNIQUE) is the backstop, never the
// normalizer. Importable under plain-node tests (relative imports only).

/** Strip every non-digit (spaces, +, -, parentheses). */
export function stripToDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Customer-identity normalization (R8). Returns the canonical `201XXXXXXXX`
 * form or throws. Accepted inputs (all converging when equivalent):
 * `010…` (11), `1…` (10, bare local), `2010…` (12), `+2010…`, `002010…`.
 * Anything else — letters-only, short, wrong prefix, non-EG mobile
 * (e.g. 014…, 019…, foreign ranges) — throws.
 */
export function normalizeIdentityPhone(raw: string): string {
  let d = stripToDigits(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (/^0\d{10}$/.test(d)) d = "20" + d.slice(1);
  else if (/^1\d{9}$/.test(d)) d = "20" + d;
  else if (!/^20\d{10}$/.test(d)) throw new Error("Invalid phone number.");
  if (!/^201[0125][0-9]{8}$/.test(d)) throw new Error("Invalid phone number.");
  return d;
}

/** Non-throwing identity check (unit-test and pre-validation helper). */
export function isIdentityPhone(raw: string): boolean {
  try {
    normalizeIdentityPhone(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Address-contact normalization. Mobiles canonicalize through the SAME
 * identity ladder (single utility — never a second ladder); landline-style
 * digit strings pass through stripped when they satisfy the frozen address
 * CHECK shape (^[0-9]{8,15}$). Anything else throws.
 */
export function normalizeContactPhone(raw: string): string {
  try {
    return normalizeIdentityPhone(raw);
  } catch {
    const d = stripToDigits(raw);
    if (/^[0-9]{8,15}$/.test(d)) return d;
    throw new Error("Invalid phone number.");
  }
}

/** Non-throwing contact check. */
export function isContactPhone(raw: string): boolean {
  try {
    normalizeContactPhone(raw);
    return true;
  } catch {
    return false;
  }
}
