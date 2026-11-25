import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_OWNER_BRAND_NAMES,
  OWNER_BRAND_RAW_NAMES,
  buildOwnerBrandManifest,
  matchProductBrand,
  normalizeBrandDuplicateKey,
} from "@/lib/catalog/brand-management";

describe("owner brand catalogue", () => {
  it("preserves every raw owner label and isolates ambiguous labels", () => {
    const manifest = buildOwnerBrandManifest();
    expect(manifest.map((row) => row.rawName)).toEqual([...OWNER_BRAND_RAW_NAMES]);
    expect(manifest.filter((row) => row.disposition === "DUPLICATE")).toHaveLength(0);
    expect(new Set(manifest.filter((row) => row.disposition === "REVIEW_REQUIRED").map((row) => row.rawName))).toEqual(new Set(AMBIGUOUS_OWNER_BRAND_NAMES));
  });

  it("normalizes only case, Unicode compatibility, and whitespace for duplicates", () => {
    expect(normalizeBrandDuplicateKey("  Good   Care ")).toBe(normalizeBrandDuplicateKey("good care"));
    expect(normalizeBrandDuplicateKey("Gardeniu")).not.toBe(normalizeBrandDuplicateKey("Gardenia"));
  });

  it("matches a complete unambiguous label with Unicode boundaries", () => {
    expect(matchProductBrand({ productId: "p1", productCode: "1", productName: "شيبسي خل 85جم" })).toMatchObject({
      proposedBrand: "شيبسي", classification: "EXACT_VERIFIED", ambiguityStatus: "NONE",
    });
  });

  it("does not match generic short labels inside unrelated words", () => {
    expect(matchProductBrand({ productId: "p2", productCode: null, productName: "Frederick soap" })).toMatchObject({ classification: "UNMATCHED" });
  });

  it("never auto-approves an explicitly ambiguous owner label", () => {
    expect(matchProductBrand({ productId: "p3", productCode: null, productName: "Fine مناديل" })).toMatchObject({
      proposedBrand: "Fine", classification: "REVIEW_REQUIRED", ambiguityStatus: "AMBIGUOUS_LABEL",
    });
  });

  it("uses aliases only when explicitly supplied as verified", () => {
    expect(matchProductBrand(
      { productId: "p4", productCode: null, productName: "Pepsi 330 ml" },
      ["بيبسي"],
      { "بيبسي": ["Pepsi"] },
    )).toMatchObject({ proposedBrand: "بيبسي", classification: "EXACT_VERIFIED", matchRule: "NAME_VERIFIED_ALIAS_BOUNDARY" });
  });
});
