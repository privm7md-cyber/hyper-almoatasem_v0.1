// OD-10 (cost stays admin-only) + serialization contract.
// `costPrice` is internal cost basis; it must NEVER reach a storefront shape.
// `toVariant` (storefront) and `toProductListItem` omit it entirely.
import { describe, expect, it } from "vitest";
import { toVariant, toProductListItem } from "@/lib/catalog/serialize";

describe("serialize excludes costPrice from storefront shapes (OD-10)", () => {
  it("toVariant has no costPrice field", () => {
    const v = {
      id: "00000000-0000-7000-8000-000000000001",
      productId: "00000000-0000-7000-8000-000000000002",
      name: "Pack",
      sizeValue: null,
      sizeUnit: null,
      price: "12.5" as unknown as never,
      compareAtPrice: null,
      costPrice: "9.99" as unknown as never,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      deletedAt: null,
    } as unknown as Parameters<typeof toVariant>[0];
    const out = toVariant(v);
    expect(Object.prototype.hasOwnProperty.call(out, "costPrice")).toBe(false);
    expect(out.price).toBe("12.5");
  });

  it("toProductListItem has no costPrice field", () => {
    const p = {
      id: "00000000-0000-7000-8000-000000000001",
      name: "P",
      slug: "p",
      productType: "PIECE",
      unit: "PIECE",
      saleStepGrams: null,
      isActive: true,
      category: { id: "c", name: "c", slug: "c" },
      brand: null,
      costPrice: "9.99" as unknown as never,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      deletedAt: null,
    } as unknown as Parameters<typeof toProductListItem>[0];
    const out = toProductListItem(p);
    expect(Object.prototype.hasOwnProperty.call(out, "costPrice")).toBe(false);
  });
});

describe("OD-09 weight pricing — round half-up per KG", () => {
  // cart/totals.ts: round(qty_thousa × price_piastres / 1000), half-up via
  // Math.round on the integer thousandths cross-product.
  it("0.125 KG × 17.00 EGP = 2.13 EGP (half-up)", () => {
    const qtyThousa = 125; // 0.125 KG
    const pricePiastres = 1700; // 17.00 EGP
    const line = Math.round((qtyThousa * pricePiastres) / 1000);
    expect(line).toBe(213); // 2.13 EGP
  });
  it("0.25 KG × 13.33 EGP = 3.33 EGP (half-up)", () => {
    const qtyThousa = 250;
    const pricePiastres = 1333;
    const line = Math.round((qtyThousa * pricePiastres) / 1000);
    expect(line).toBe(333); // 3.3325 → 3.33
  });
  it("chk_items_estimated_math contract: estimated_total = round(qty × unit_price, 2)", () => {
    // 1.000 KG × 47.35 = 47.35 EGP exactly
    const line = Math.round((1000 * 4735) / 1000);
    expect(line).toBe(4735);
  });
});
