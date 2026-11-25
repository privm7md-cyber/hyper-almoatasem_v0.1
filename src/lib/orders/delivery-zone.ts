// Delivery-zone locality normalization (pure, no DB, no server-only).
//
// The ONLY matching rule: an explicitly configured zone key (area > village >
// city) equals the normalized form of the address field. No fuzzy matching,
// no distance/GPS, no address-text guessing, no transliteration.
//
// Normalization is deliberately orthographic only:
//   • NFKC compatibility normalization
//   • remove Arabic tatweel + basic diacritics
//   • collapse whitespace, trim, lowercase
//   • unify common Arabic orthographic variants (أإآٱ -> ا, ى -> ي, ة -> ه)
// The admin write path and the checkout resolver call the SAME function, so a
// saved zone key always means exactly what the resolver compares against.
// Importable under plain-node tests (no server-only imports).

export interface DeliveryLocality {
  city?: string | null;
  area?: string | null;
  village?: string | null;
}

export type DeliveryLocalityField = "area" | "village" | "city";

export interface DeliveryLocalityKey {
  field: DeliveryLocalityField;
  key: string;
}

const ARABIC_MARKS = /[\u0640\u064B-\u0652\u0670]/g;

/** Normalize one locality string; null/blank becomes null (never ""). */
export function normalizeDeliveryLocality(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = raw
    .normalize("NFKC")
    .replace(ARABIC_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized === "" ? null : normalized;
}

/**
 * Ordered, de-duplicated locality keys for one address. Area beats village
 * beats city; if two fields normalize to the same key, only the higher-priority
 * field is kept (the resolver would match the same zone row anyway).
 */
export function deliveryLocalityKeys(address: DeliveryLocality | null | undefined): DeliveryLocalityKey[] {
  if (!address) return [];
  const out: DeliveryLocalityKey[] = [];
  const seen = new Set<string>();
  for (const field of ["area", "village", "city"] as const) {
    const key = normalizeDeliveryLocality(address[field]);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    out.push({ field, key });
  }
  return out;
}
