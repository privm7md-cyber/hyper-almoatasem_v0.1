// Phase-10 remediation unit tests: exact price comparison (G02).
//
// The selling price column is NUMERIC(10,2). "15", "15.00" and "15.000" are
// the SAME price; "15.005" is not representable at the approved precision and
// must be refused (never silently rounded). Every comparison here is exact —
// no JavaScript floating point touches a commercial value.
import { describe, expect, it } from "vitest";
import { canonicalDecimal, decimalsEqual, isValidPriceText } from "@/lib/catalog/price";
import { variantPriceInputSchema } from "@/lib/catalog/validation";

describe("exact price comparison (G02)", () => {
  it("canonicalises a decimal without floating point", () => {
    expect(canonicalDecimal("15")).toBe("15");
    expect(canonicalDecimal("15.00")).toBe("15");
    expect(canonicalDecimal("15.000")).toBe("15");
    expect(canonicalDecimal("15.50")).toBe("15.5");
    expect(canonicalDecimal("0.00")).toBe("0");
    expect(canonicalDecimal("15.005")).toBeNull();
    expect(canonicalDecimal("abc")).toBeNull();
    expect(canonicalDecimal("-1")).toBeNull();
  });

  it("treats equal values written differently as equal", () => {
    expect(decimalsEqual("15", "15.00")).toBe(true);
    expect(decimalsEqual("15.00", "15.000")).toBe(true);
    expect(decimalsEqual("15.5", "15.50")).toBe(true);
    expect(decimalsEqual("15", "15.01")).toBe(false);
    expect(decimalsEqual("15", "15.005")).toBe(false);
  });

  it("validates the approved precision", () => {
    expect(isValidPriceText("15")).toBe(true);
    expect(isValidPriceText("15.00")).toBe(true);
    expect(isValidPriceText("15.000")).toBe(true);
    expect(isValidPriceText("15.005")).toBe(false);
    expect(isValidPriceText("-1")).toBe(false);
    expect(isValidPriceText("1e3")).toBe(false);
  });

  it("accepts the equivalent spellings and refuses an unrepresentable value", () => {
    for (const price of ["15", "15.00", "15.000"]) {
      const parsed = variantPriceInputSchema.safeParse({ price });
      expect(parsed.success, `price ${price} should be accepted`).toBe(true);
    }
    for (const price of ["15.005", "-1", "abc", ""]) {
      const parsed = variantPriceInputSchema.safeParse({ price });
      expect(parsed.success, `price ${price} should be refused`).toBe(false);
    }
  });
});
