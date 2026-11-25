// Catalog name integrity — DISPLAY-ONLY classifier (Phase 14.1 constraint).
//
// This module never mutates data, never decodes, never guesses replacements,
// and never feeds a write path. It only LABELS what the stored text looks like
// so an operator can see the catalog as it truly is (Phase-14.1: the restore
// of the ~20k mojibake names is a separate owner-gated data project).
//
// Classification is deliberately conservative — a wrong "looks fine" is worse
// than an extra review flag:
//   - test-data     : known seed/testing patterns (BA11A / BA-B-SCALE / bab-scale…)
//   - needs-review : replacement chars, control chars, or the characteristic
//                     cp1256-as-UTF8 mojibake alphabet (Ø Ù Ú Û …) in density
//   - trusted-arabic: contains real Arabic letters and no flags above
//   - trusted-latin : clean Latin text (legitimate foreign brands, e.g. Pepsi)

export type NameTrust = "trusted-arabic" | "trusted-latin" | "needs-review" | "test-data";

/** Known synthetic-data signatures from historical seed scripts (Phase 14.1 evidence). */
const TEST_PATTERNS: RegExp[] = [
  /^BA11A\b/,
  /^BA-B-SCALE\b/i,
  /\bbab-scale\b/i,
  /^Prod\s+\w*\d/i,
  /** Phase-10 UI rehearsal fixtures (still present in the scratch catalogue). */
  /^phase\d+-ui-/i,
  /**
   * Fixture CUSTOMERS and TEAM ACCOUNTS. The names come from this project's
   * own end-to-end scripts, so the signature is the evidence:
   *   e2e/phase10-remediation.spec.ts  → "P10 E2E"
   *   e2e/phase10-fixtures.ts          → "P10 Probe", "P10 Store"
   *   e2e/p13r-account-runtime.spec.ts → "P13RA", "P13RB", "P13RC"
   * A label, never a filter: nothing is hidden because of it.
   */
  /^P\d+\s*E2E$/i,
  /^P\d+\s+(Probe|Store)$/i,
  /^P13R[ABC]$/i,
];

/** Replacement character and C0 control characters — never trustworthy. */
const BROKEN_CHARS = /[\uFFFD\u0000-\u001F\u007F]/;

/**
 * The mojibake telltale alphabet: Arabic text stored as UTF-8 bytes then read
 * as cp1252/latin1 surfaces as dense runs of Ø/Ù/Ú/Û (+ punctuation). A single
 * occurrence could theoretically be a name like "Øresund"; two or more is
 * effectively never a real product name, so density ≥ 2 flags review.
 */
const MOJIBAKE_CHARS = /[ØÙÚÛÜÝÞß]/g;

const ARABIC_LETTER = /[\u0621-\u064A]/;
const LATIN_LETTER = /[A-Za-z]/;

export function classifyCatalogName(name: string): NameTrust {
  if (TEST_PATTERNS.some((re) => re.test(name))) return "test-data";
  if (BROKEN_CHARS.test(name)) return "needs-review";
  const mojibakeCount = name.match(MOJIBAKE_CHARS)?.length ?? 0;
  if (mojibakeCount >= 2) return "needs-review";
  if (ARABIC_LETTER.test(name)) return "trusted-arabic";
  if (LATIN_LETTER.test(name)) return "trusted-latin";
  // Digits/symbols/empty-only strings carry no readable identity — flag them.
  return "needs-review";
}
