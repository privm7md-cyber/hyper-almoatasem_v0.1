import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_TO, returnToQuery, safeReturnTo } from "@/lib/frontend/return-to";

describe("safeReturnTo (NAV-02 policy)", () => {
  it("falls back to /account for empty/absent/unsafe values", () => {
    expect(safeReturnTo(null)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("   ")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("https://evil.example")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("http://evil.example/path")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("//evil.example")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/\\evil.example")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("javascript:alert(1)")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("account/addresses")).toBe(DEFAULT_RETURN_TO);
  });

  it("falls back for encoded-protocol-relative and backslash/control-char tricks", () => {
    expect(safeReturnTo("/%2F%2Fevil.example")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/%5Cevil.example")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/account\\evil")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/account\n/next")).toBe(DEFAULT_RETURN_TO);
  });

  it("falls back for admin, api and auth pages (out of storefront scope / loops)", () => {
    expect(safeReturnTo("/admin")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/admin/orders")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/API/products")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/api/store/products")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/login")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/register")).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo("/login?next=/cart")).toBe(DEFAULT_RETURN_TO);
  });

  it("preserves safe internal storefront destinations", () => {
    expect(safeReturnTo("/account/addresses")).toBe("/account/addresses");
    expect(safeReturnTo("/cart")).toBe("/cart");
    expect(safeReturnTo("/cart?x=1")).toBe("/cart?x=1");
    expect(safeReturnTo("/p/some-product")).toBe("/p/some-product");
    expect(safeReturnTo("/categories/kitchen#section")).toBe("/categories/kitchen#section");
    expect(safeReturnTo(" /cart ")).toBe("/cart");
  });

  it("caps length to avoid abuse", () => {
    expect(safeReturnTo(`/${"a".repeat(600)}`)).toBe(DEFAULT_RETURN_TO);
    expect(safeReturnTo(`/${"a".repeat(200)}`)).toBe(`/${"a".repeat(200)}`);
  });
});

describe("returnToQuery", () => {
  it("is empty when the destination is the default", () => {
    expect(returnToQuery(undefined)).toBe("");
    expect(returnToQuery(null)).toBe("");
    expect(returnToQuery("https://evil.example")).toBe("");
    expect(returnToQuery("/account")).toBe("");
  });

  it("encodes safe destinations", () => {
    expect(returnToQuery("/account/addresses")).toBe("?next=%2Faccount%2Faddresses");
    expect(returnToQuery("/cart?x=1")).toBe("?next=%2Fcart%3Fx%3D1");
  });
});
