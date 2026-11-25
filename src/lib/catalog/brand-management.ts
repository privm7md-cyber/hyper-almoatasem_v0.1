/** Owner brand catalogue + deterministic, read-only product matching rules. */

export const OWNER_BRAND_RAW_NAMES = [
  "بيبسي", "كوكاكولا", "المراعي", "شيبسي", "لايون", "تايجر", "بيك", "Abu Auf",
  "مصري كافيه", "ناس كافيه", "Coffee Break", "Bon", "عب معبود", "بن الدلة", "بن شهين",
  "Buongiorno", "Lepton", "العروسة", "أحمد تي", "الكابوس", "إزيس", "Dream", "ماجي",
  "Konur", "Wells", "الضحى", "سنبلة", "الفرات", "العمدة", "الفيروز", "الساعة", "رحانة",
  "الملكة", "استار", "دولفين", "صن شاين", "فتراك", "رشيد", "الميزان", "حلواني", "كريستال",
  "روابي", "قوت", "جنة", "الهانم", "عافية", "جهينه", "دورا", "هاينز", "Gardeniu", "Fine",
  "malfix", "good care", "Oxy", "Ariel", "Persil", "Bahi", "Farida", "Red", "Feba", "Klaus",
  "Axe", "Fog", "Lux", "Camay", "Joy",
] as const;

/** Labels intentionally held out of unattended installation/matching. */
export const AMBIGUOUS_OWNER_BRAND_NAMES = [
  "Bon", "Red", "Fine", "Lepton", "Konur", "Gardeniu", "عب معبود",
] as const;

export type OwnerBrandName = (typeof OWNER_BRAND_RAW_NAMES)[number];
export type BrandMatchClassification = "EXACT_VERIFIED" | "REVIEW_REQUIRED" | "UNMATCHED";

export interface OwnerBrandManifestEntry {
  rawName: string;
  normalizedDuplicateKey: string;
  disposition: "INSTALL" | "REVIEW_REQUIRED" | "DUPLICATE";
  reason: string;
}

export interface BrandMatchInput {
  productId: string;
  productCode: string | null;
  productName: string;
  structuredBrand?: string | null;
}

export interface BrandMatchResult {
  productId: string;
  productCode: string | null;
  productName: string;
  proposedBrand: string | null;
  classification: BrandMatchClassification;
  matchRule: string;
  evidence: string;
  ambiguityStatus: "NONE" | "AMBIGUOUS_LABEL" | "MULTIPLE_MATCHES" | "NO_MATCH";
}

export type VerifiedBrandAliases = Readonly<Record<string, readonly string[]>>;

export function normalizeBrandDuplicateKey(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function buildOwnerBrandManifest(
  names: readonly string[] = OWNER_BRAND_RAW_NAMES,
): OwnerBrandManifestEntry[] {
  const ambiguous = new Set(AMBIGUOUS_OWNER_BRAND_NAMES.map(normalizeBrandDuplicateKey));
  const seen = new Set<string>();
  return names.map((rawName) => {
    const key = normalizeBrandDuplicateKey(rawName);
    if (seen.has(key)) {
      return { rawName, normalizedDuplicateKey: key, disposition: "DUPLICATE", reason: "تكرار مطابق بعد توحيد المسافات وحالة الأحرف فقط." };
    }
    seen.add(key);
    if (ambiguous.has(key)) {
      return { rawName, normalizedDuplicateKey: key, disposition: "REVIEW_REQUIRED", reason: "تسمية قصيرة أو ملتبسة؛ تُحفظ كما وردت ولا تُصحح أو تُربط تلقائيًا." };
    }
    return { rawName, normalizedDuplicateKey: key, disposition: "INSTALL", reason: "تسمية مالك غير مكررة وغير موجودة في قائمة الالتباس." };
  });
}

function hasUnicodeBoundaryMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(haystack);
}

function isGenericShortLabel(label: string): boolean {
  const compact = label.replace(/[^\p{L}\p{N}]/gu, "");
  return compact.length <= 3;
}

/**
 * No fuzzy/similarity matching. A match must be exact structured metadata or
 * a complete name token/phrase with Unicode-safe boundaries. Aliases are used
 * only when the caller supplies an explicitly verified map.
 */
export function matchProductBrand(
  input: BrandMatchInput,
  catalog: readonly string[] = OWNER_BRAND_RAW_NAMES,
  verifiedAliases: VerifiedBrandAliases = {},
): BrandMatchResult {
  const ambiguous = new Set(AMBIGUOUS_OWNER_BRAND_NAMES.map(normalizeBrandDuplicateKey));
  const structured = input.structuredBrand ? normalizeBrandDuplicateKey(input.structuredBrand) : null;
  const productName = normalizeBrandDuplicateKey(input.productName);
  const matches: Array<{ brand: string; rule: string; evidence: string }> = [];

  for (const brand of catalog) {
    const labels = [brand, ...(verifiedAliases[brand] ?? [])];
    for (const label of labels) {
      const normalizedLabel = normalizeBrandDuplicateKey(label);
      if (structured !== null && structured === normalizedLabel) {
        matches.push({ brand, rule: label === brand ? "STRUCTURED_EXACT" : "STRUCTURED_VERIFIED_ALIAS", evidence: `structuredBrand=${input.structuredBrand}` });
        break;
      }
      if (hasUnicodeBoundaryMatch(productName, normalizedLabel)) {
        matches.push({ brand, rule: label === brand ? "NAME_BOUNDARY" : "NAME_VERIFIED_ALIAS_BOUNDARY", evidence: `name contains bounded label '${label}'` });
        break;
      }
    }
  }

  const unique = [...new Map(matches.map((m) => [normalizeBrandDuplicateKey(m.brand), m])).values()];
  if (unique.length === 0) {
    return { ...input, proposedBrand: null, classification: "UNMATCHED", matchRule: "NO_RELIABLE_BOUNDARY", evidence: "No exact structured label or bounded approved label was found.", ambiguityStatus: "NO_MATCH" };
  }
  if (unique.length > 1) {
    return { ...input, proposedBrand: null, classification: "REVIEW_REQUIRED", matchRule: "MULTIPLE_BOUNDED_LABELS", evidence: unique.map((m) => `${m.brand}: ${m.evidence}`).join(" | "), ambiguityStatus: "MULTIPLE_MATCHES" };
  }

  const hit = unique[0];
  const key = normalizeBrandDuplicateKey(hit.brand);
  if (ambiguous.has(key) || isGenericShortLabel(key)) {
    return { ...input, proposedBrand: hit.brand, classification: "REVIEW_REQUIRED", matchRule: hit.rule, evidence: hit.evidence, ambiguityStatus: "AMBIGUOUS_LABEL" };
  }
  return { ...input, proposedBrand: hit.brand, classification: "EXACT_VERIFIED", matchRule: hit.rule, evidence: hit.evidence, ambiguityStatus: "NONE" };
}
