import { describe, expect, it } from "vitest";
import {
  createBrandMatcher,
  isActionableClassification,
  requiresCrosswalkApproval,
  type BrandIdentity,
} from "@/lib/catalog/brand-association";

const BRANDS: BrandIdentity[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "بيبسي" },
  { id: "22222222-2222-4222-8222-222222222222", name: "شيبسي" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Abu Auf" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Oxy" },
  { id: "55555555-5555-4555-8555-555555555555", name: "الميزان" },
  { id: "66666666-6666-4666-8666-666666666666", name: "رحانة" },
  { id: "77777777-7777-4777-8777-777777777777", name: "إزيس" },
  { id: "88888888-8888-4888-8888-888888888888", name: "مصري كافيه" },
];

const matcher = createBrandMatcher(BRANDS);

function idOf(name: string): string {
  return BRANDS.find((brand) => brand.name === name)!.id;
}

describe("brand association classifier", () => {
  it("verifies an exact brand at the start of the product name", () => {
    const result = matcher.classify("بيبسي كولا 330مل");
    expect(result.classification).toBe("EXACT_VERIFIED");
    expect(result.proposedBrandId).toBe(idOf("بيبسي"));
    expect(result.matchedKey?.position).toBe(0);
    expect(result.flags).toEqual([]);
  });

  it("normalizes Arabic alef/ya variants for comparison without rewriting the label", () => {
    const result = matcher.classify("ازيس زيت زتون250مل");
    expect(result.classification).toBe("EXACT_VERIFIED");
    expect(result.proposedBrandId).toBe(idOf("إزيس"));
    expect(result.matchedKey?.key).toBe("إزيس");
  });

  it("verifies a multi-token brand phrase", () => {
    const result = matcher.classify("مصري كافيه بن 250جم");
    expect(result.classification).toBe("EXACT_VERIFIED");
    expect(result.proposedBrandId).toBe(idOf("مصري كافيه"));
    expect(result.confidence).toBeGreaterThan(0.95);
  });

  it("requires review when the brand token is not at the start", () => {
    const result = matcher.classify("عبوة بيبسي 1.5 لتر");
    expect(result.classification).toBe("REVIEW_REQUIRED");
    expect(result.flags).toContain("BRAND_TOKEN_NOT_AT_PRODUCT_START");
    expect(result.proposedBrandId).toBe(idOf("بيبسي"));
  });

  it("requires review for a cross-language alias and flags the unapproved crosswalk", () => {
    const result = matcher.classify("ابو عوف بندق 100جم");
    expect(result.classification).toBe("REVIEW_REQUIRED");
    expect(result.proposedBrandId).toBe(idOf("Abu Auf"));
    expect(result.flags).toContain("ALIAS_CROSSWALK_NOT_OWNER_APPROVED");
    expect(requiresCrosswalkApproval(result)).toBe(true);
  });

  it("requires review for the known spelling variant", () => {
    const result = matcher.classify("ريحانه شاي 100فتلة");
    expect(result.classification).toBe("REVIEW_REQUIRED");
    expect(result.proposedBrandId).toBe(idOf("رحانة"));
    expect(result.flags).toContain("SPELLING_VARIANT_REVIEW");
    expect(requiresCrosswalkApproval(result)).toBe(true);
  });

  it("flags a short/generic token even at the product-name start", () => {
    const result = matcher.classify("الميزان ارز 5كجم");
    expect(result.classification).toBe("REVIEW_REQUIRED");
    expect(result.flags).toContain("SHORT_OR_GENERIC_BRAND_TOKEN");
    expect(requiresCrosswalkApproval(result)).toBe(false);
  });

  it("refuses to choose when two distinct brands match", () => {
    const result = matcher.classify("بيبسي شيبسي عرض");
    expect(result.classification).toBe("AMBIGUOUS_CONFLICT");
    expect(result.proposedBrandId).toBeNull();
    expect(result.ambiguousBrands.map((brand) => brand.name).sort()).toEqual(["بيبسي", "شيبسي"].sort());
    expect(isActionableClassification(result.classification)).toBe(false);
  });

  it("returns UNMATCHED when no brand key is present", () => {
    const result = matcher.classify("كيس بلاستيك شفاف");
    expect(result.classification).toBe("UNMATCHED");
    expect(result.proposedBrandId).toBeNull();
    expect(result.flags).toEqual(["NO_BRAND_EVIDENCE"]);
  });

  it("does not invent an alias target that is absent from the brand table", () => {
    const withoutAbuAuf = createBrandMatcher(BRANDS.filter((brand) => brand.name !== "Abu Auf"));
    const result = withoutAbuAuf.classify("ابو عوف بندق 100جم");
    expect(result.classification).toBe("UNMATCHED");
    expect(result.proposedBrandId).toBeNull();
  });

  it("prefers a DB exact key over an alias key for the same brand", () => {
    const result = matcher.classify("Oxy اوكسى صابون");
    expect(result.classification).toBe("EXACT_VERIFIED");
    expect(result.matchedKey?.keyType).toBe("DB_EXACT");
    expect(result.proposedBrandId).toBe(idOf("Oxy"));
  });
});
