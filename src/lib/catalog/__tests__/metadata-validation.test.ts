import { describe, expect, it } from "vitest";
import {
  analyzeVariantMetadata,
  normalizePackageUnit,
  normalizeVariantName,
} from "@/lib/catalog/metadata-validation";

describe("package metadata validation", () => {
  it("keeps a sealed 500g package as a valid PIECE selling model", () => {
    const result = analyzeVariantMetadata({ productType: "PIECE", sellingUnit: "PIECE", sizeValue: "500", sizeUnit: "GRAM" });
    expect(result.sellingModel).toBe("PIECE");
    expect(result.validForWrite).toBe(true);
    expect(result.issues).toContain("PACKAGED_PIECE");
    expect(result.issues).not.toContain("WEIGHT_PRICE_BASIS_CONFLICT");
  });

  it("requires value and unit as one package-metadata pair", () => {
    const result = analyzeVariantMetadata({ productType: "PIECE", sellingUnit: "PIECE", sizeValue: "500", sizeUnit: null });
    expect(result.validForWrite).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(["MISSING_SIZE_UNIT", "PARTIAL_SIZE_PAIR"]));
  });

  it("preserves the KG pricing basis for actual WEIGHT products", () => {
    expect(analyzeVariantMetadata({ productType: "WEIGHT", sellingUnit: "KG", sizeValue: "250", sizeUnit: "GRAM" })).toMatchObject({
      validForWrite: false,
      issues: expect.arrayContaining(["WEIGHT_PRICE_BASIS_CONFLICT"]),
    });
    expect(analyzeVariantMetadata({ productType: "WEIGHT", sellingUnit: "KG", sizeValue: "1", sizeUnit: "KG" }).validForWrite).toBe(true);
  });

  it("normalizes supported Arabic and English source units without guessing values", () => {
    expect(normalizePackageUnit("جرام")).toBe("GRAM");
    expect(normalizePackageUnit("KG")).toBe("KG");
    expect(normalizePackageUnit("millilitre")).toBe("ML");
    expect(normalizePackageUnit("كرتونة")).toBeNull();
  });

  it("detects duplicate variant names case-insensitively after whitespace normalization", () => {
    expect(normalizeVariantName("  Pack   Large ")).toBe(normalizeVariantName("pack large"));
  });
});
