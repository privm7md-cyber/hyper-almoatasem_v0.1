// Display-only name-integrity classifier (Phase 14.1 constraint): it must
// LABEL stored text without ever mutating or "fixing" it. These cases mirror
// the real catalog evidence: clean Arabic, legitimate foreign brands, the
// cp1256-mojibake alphabet, replacement chars, and seed test data.

import { describe, expect, it } from "vitest";
import { classifyCatalogName } from "../name-integrity";

describe("classifyCatalogName (display-only)", () => {
  it("trusts clean Arabic product names", () => {
    expect(classifyCatalogName("أرز بسمتي")).toBe("trusted-arabic");
    expect(classifyCatalogName("لحمة بقري 16")).toBe("trusted-arabic");
  });

  it("trusts legitimate foreign brand names", () => {
    expect(classifyCatalogName("Pepsi")).toBe("trusted-latin");
    expect(classifyCatalogName("Coca-Cola 1L")).toBe("trusted-latin");
  });

  it("flags the cp1256-as-UTF8 mojibake alphabet for review", () => {
    // Real stored pattern shape from Phase 14.1 evidence (dense Ø/Ù runs).
    expect(classifyCatalogName("Ø£Ø±Ø² Ø¨Ø³Ù…ØªÙŠ")).toBe("needs-review");
    expect(classifyCatalogName("Ù„Ø­Ù…Ø©")).toBe("needs-review");
  });

  it("flags replacement and control characters", () => {
    expect(classifyCatalogName("حليب \uFFFD")).toBe("needs-review");
    expect(classifyCatalogName("جبنة\u0007")).toBe("needs-review");
  });

  it("flags known seed/test data patterns without hiding them", () => {
    expect(classifyCatalogName("BA11A Prod mvyg9nu9 X")).toBe("test-data");
    expect(classifyCatalogName("BA-B-SCALE ألبان")).toBe("test-data");
    expect(classifyCatalogName("bab-scale-p-0")).toBe("test-data");
  });

  it("flags identity-less strings (digits/symbols only) for review", () => {
    expect(classifyCatalogName("12345")).toBe("needs-review");
    expect(classifyCatalogName("***")).toBe("needs-review");
  });
});
