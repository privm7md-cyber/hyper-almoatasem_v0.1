// Deterministic product → brand candidate classification (pure, no I/O).
//
// This module is the single source of truth for the brand-association review
// surface and for the server-side apply re-validation. It implements strict
// normalized token-phrase matching:
//
//   - a brand key must match as a complete token phrase (never a substring),
//   - an exact DB/owner key at the start of the product name is EXACT_VERIFIED,
//   - a cross-language alias, a spelling variant, a non-start position, or a
//     short/generic token is REVIEW_REQUIRED,
//   - two or more distinct DB brands in one product name is AMBIGUOUS_CONFLICT,
//   - no key at all is UNMATCHED.
//
// Nothing here writes data, invents a canonical spelling, or auto-approves an
// alias. The alias map is the explicit crosswalk recovered from the owner-list
// reconciliation and is surfaced to the owner as a proposal only.

export type BrandAssociationClassification =
  | "EXACT_VERIFIED"
  | "REVIEW_REQUIRED"
  | "AMBIGUOUS_CONFLICT"
  | "UNMATCHED";

export type BrandKeyType = "DB_EXACT" | "ALIAS_PROPOSED" | "SPELLING_REVIEW";

export interface BrandIdentity {
  id: string;
  name: string;
}

export interface BrandMatchKey {
  brandId: string;
  brandName: string;
  key: string;
  norm: string;
  tokens: string[];
  keyType: BrandKeyType;
}

export interface BrandMatchEvidence {
  brandId: string;
  brandName: string;
  key: string;
  keyType: BrandKeyType;
  position: number;
  tokenLength: number;
}

export interface BrandAssociationProposal {
  classification: BrandAssociationClassification;
  proposedBrandId: string | null;
  proposedBrandName: string | null;
  confidence: number;
  confidenceLabel: "HIGH" | "MEDIUM" | "CONFLICT" | "NONE";
  reason: string;
  flags: string[];
  matchedKey: BrandMatchEvidence | null;
  ambiguousBrands: Array<{ id: string; name: string; key: string }>;
  productTokenCount: number;
}

/** Explicit Arabic/Latin crosswalk recovered from the owner-list reconciliation. */
export const OWNER_ALIASES: ReadonlyArray<{ label: string; brandName: string }> = [
  { label: "ابو عوف", brandName: "Abu Auf" },
  { label: "كوفي بريك", brandName: "Coffee Break" },
  { label: "بونجورنو", brandName: "Buongiorno" },
  { label: "دريم", brandName: "Dream" },
  { label: "ويلز", brandName: "Wells" },
  { label: "مولفيكس", brandName: "malfix" },
  { label: "جود كير", brandName: "good care" },
  { label: "اوكسى", brandName: "Oxy" },
  { label: "اريل", brandName: "Ariel" },
  { label: "برسيل", brandName: "Persil" },
  { label: "باهي", brandName: "Bahi" },
  { label: "فريدا", brandName: "Farida" },
  { label: "فيبا", brandName: "Feba" },
  { label: "فوج", brandName: "Fog" },
  { label: "لوكس", brandName: "Lux" },
  { label: "جوي", brandName: "Joy" },
] as const;

/** Spelling review proposals only; the owner spelling is never overwritten. */
export const OWNER_SPELLING_REVIEWS: ReadonlyArray<{ label: string; brandName: string; note: string }> = [
  {
    label: "ريحانه",
    brandName: "رحانة",
    note: "One-letter spelling variant; product names use the owner spelling. The owner must decide the canonical spelling.",
  },
] as const;

/** Short tokens that match many unrelated product names; never verified automatically. */
export const GENERIC_BRAND_TOKENS: ReadonlySet<string> = new Set([
  "الميزان",
  "جنه",
  "قوت",
  "جوي",
  "ريد",
  "فاين",
  "بيك",
  "رشيد",
]);

/** Normalize for comparison only. Never write the normalized form back. */
export function normalizeBrandText(value: string): string {
  return String(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u0640\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeBrandText(value: string): string[] {
  return normalizeBrandText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function findPhrasePositions(haystackTokens: readonly string[], needleTokens: readonly string[]): number[] {
  const positions: number[] = [];
  if (needleTokens.length === 0) return positions;
  for (let i = 0; i + needleTokens.length <= haystackTokens.length; i++) {
    let matched = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        matched = false;
        break;
      }
    }
    if (matched) positions.push(i);
  }
  return positions;
}

function addKey(
  keys: BrandMatchKey[],
  brandsByName: ReadonlyMap<string, BrandIdentity>,
  brandName: string,
  key: string,
  keyType: BrandKeyType,
): void {
  const brand = brandsByName.get(brandName);
  if (!brand) return;
  const norm = normalizeBrandText(key);
  if (!norm) return;
  if (keys.some((entry) => entry.brandId === brand.id && entry.norm === norm && entry.keyType === keyType)) {
    return;
  }
  keys.push({
    brandId: brand.id,
    brandName: brand.name,
    key,
    norm,
    tokens: tokenizeBrandText(key),
    keyType,
  });
}

/** Build the deterministic key set for a brand catalog. */
export function buildBrandMatchKeys(brands: readonly BrandIdentity[]): BrandMatchKey[] {
  const brandsByName = new Map(brands.map((brand) => [brand.name, brand]));
  const keys: BrandMatchKey[] = [];
  for (const brand of brands) addKey(keys, brandsByName, brand.name, brand.name, "DB_EXACT");
  for (const alias of OWNER_ALIASES) addKey(keys, brandsByName, alias.brandName, alias.label, "ALIAS_PROPOSED");
  for (const review of OWNER_SPELLING_REVIEWS) {
    addKey(keys, brandsByName, review.brandName, review.label, "SPELLING_REVIEW");
  }
  return keys;
}

const KEY_RANK: Record<BrandKeyType, number> = {
  DB_EXACT: 4,
  ALIAS_PROPOSED: 2,
  SPELLING_REVIEW: 1,
};

export interface BrandMatcher {
  readonly keys: readonly BrandMatchKey[];
  classify(productName: string): BrandAssociationProposal;
}

/** Create a reusable matcher (keys are built once per catalog read). */
export function createBrandMatcher(brands: readonly BrandIdentity[]): BrandMatcher {
  const keys = buildBrandMatchKeys(brands);
  const keysByBrand = new Map<string, BrandMatchKey[]>();
  for (const key of keys) {
    const list = keysByBrand.get(key.brandId);
    if (list) list.push(key);
    else keysByBrand.set(key.brandId, [key]);
  }

  function classify(productName: string): BrandAssociationProposal {
    const productTokens = tokenizeBrandText(productName);
    const bestByBrand = new Map<string, BrandMatchEvidence>();

    for (const key of keys) {
      if (key.tokens.length === 0) continue;
      const positions = findPhrasePositions(productTokens, key.tokens);
      for (const position of positions) {
        const evidence: BrandMatchEvidence = {
          brandId: key.brandId,
          brandName: key.brandName,
          key: key.key,
          keyType: key.keyType,
          position,
          tokenLength: key.tokens.length,
        };
        const current = bestByBrand.get(key.brandId);
        if (
          !current ||
          KEY_RANK[evidence.keyType] > KEY_RANK[current.keyType] ||
          (KEY_RANK[evidence.keyType] === KEY_RANK[current.keyType] && evidence.position < current.position)
        ) {
          bestByBrand.set(key.brandId, evidence);
        }
      }
    }

    const distinct = [...bestByBrand.values()].sort((a, b) => a.brandName.localeCompare(b.brandName));

    if (distinct.length === 0) {
      return {
        classification: "UNMATCHED",
        proposedBrandId: null,
        proposedBrandName: null,
        confidence: 0,
        confidenceLabel: "NONE",
        reason: "No owner/DB brand key appears as a full token phrase in the product name.",
        flags: ["NO_BRAND_EVIDENCE"],
        matchedKey: null,
        ambiguousBrands: [],
        productTokenCount: productTokens.length,
      };
    }

    if (distinct.length > 1) {
      return {
        classification: "AMBIGUOUS_CONFLICT",
        proposedBrandId: null,
        proposedBrandName: null,
        confidence: 0,
        confidenceLabel: "CONFLICT",
        reason: `Product name matches ${distinct.length} distinct DB brands; no automatic choice is permitted.`,
        flags: ["MULTIPLE_BRAND_MATCHES", ...distinct.map((match) => `CANDIDATE:${match.brandName}`)],
        matchedKey: null,
        ambiguousBrands: distinct.map((match) => ({ id: match.brandId, name: match.brandName, key: match.key })),
        productTokenCount: productTokens.length,
      };
    }

    const match = distinct[0];
    const flags: string[] = [];
    if (match.keyType === "ALIAS_PROPOSED") flags.push("ALIAS_CROSSWALK_NOT_OWNER_APPROVED");
    if (match.keyType === "SPELLING_REVIEW") flags.push("SPELLING_VARIANT_REVIEW");
    if (match.position > 0) flags.push("BRAND_TOKEN_NOT_AT_PRODUCT_START");
    if (GENERIC_BRAND_TOKENS.has(normalizeBrandText(match.key))) flags.push("SHORT_OR_GENERIC_BRAND_TOKEN");

    if (match.keyType === "ALIAS_PROPOSED") {
      return {
        classification: "REVIEW_REQUIRED",
        proposedBrandId: match.brandId,
        proposedBrandName: match.brandName,
        confidence: 0.72,
        confidenceLabel: "MEDIUM",
        reason: `Owner label "${match.key}" is an explicit cross-language alias for ${match.brandName}; the crosswalk requires owner approval.`,
        flags,
        matchedKey: match,
        ambiguousBrands: [],
        productTokenCount: productTokens.length,
      };
    }

    if (match.keyType === "SPELLING_REVIEW") {
      return {
        classification: "REVIEW_REQUIRED",
        proposedBrandId: match.brandId,
        proposedBrandName: match.brandName,
        confidence: 0.72,
        confidenceLabel: "MEDIUM",
        reason: `Owner label "${match.key}" is a spelling variant candidate for ${match.brandName}; the owner must confirm the spelling.`,
        flags,
        matchedKey: match,
        ambiguousBrands: [],
        productTokenCount: productTokens.length,
      };
    }

    if (match.position > 0) {
      return {
        classification: "REVIEW_REQUIRED",
        proposedBrandId: match.brandId,
        proposedBrandName: match.brandName,
        confidence: 0.68,
        confidenceLabel: "MEDIUM",
        reason: `DB brand "${match.brandName}" appears as a full token phrase at position ${match.position}, not at the product-name start.`,
        flags,
        matchedKey: match,
        ambiguousBrands: [],
        productTokenCount: productTokens.length,
      };
    }

    if (GENERIC_BRAND_TOKENS.has(normalizeBrandText(match.key))) {
      return {
        classification: "REVIEW_REQUIRED",
        proposedBrandId: match.brandId,
        proposedBrandName: match.brandName,
        confidence: 0.74,
        confidenceLabel: "MEDIUM",
        reason: `DB brand "${match.brandName}" matches at the product-name start but is a short/generic token requiring review.`,
        flags,
        matchedKey: match,
        ambiguousBrands: [],
        productTokenCount: productTokens.length,
      };
    }

    return {
      classification: "EXACT_VERIFIED",
      proposedBrandId: match.brandId,
      proposedBrandName: match.brandName,
      confidence: match.tokenLength >= 2 ? 0.97 : 0.93,
      confidenceLabel: "HIGH",
      reason: `Owner/DB brand key "${match.key}" matches the product-name start as an exact full token phrase (${match.tokenLength} token${match.tokenLength === 1 ? "" : "s"}).`,
      flags,
      matchedKey: match,
      ambiguousBrands: [],
      productTokenCount: productTokens.length,
    };
  }

  return { keys, classify };
}

export function isActionableClassification(classification: BrandAssociationClassification): boolean {
  return classification === "EXACT_VERIFIED" || classification === "REVIEW_REQUIRED";
}

/** Review-class rows need an explicit crosswalk acknowledgment before apply. */
export function requiresCrosswalkApproval(proposal: BrandAssociationProposal): boolean {
  return (
    proposal.classification === "REVIEW_REQUIRED" &&
    (proposal.matchedKey?.keyType === "ALIAS_PROPOSED" || proposal.matchedKey?.keyType === "SPELLING_REVIEW")
  );
}
