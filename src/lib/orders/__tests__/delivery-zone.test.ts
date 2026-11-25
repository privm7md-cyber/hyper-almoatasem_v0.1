// Delivery-zone normalization (pure): the admin write path and the checkout
// resolver must derive the exact same key. These tests pin the normalization
// contract (NFKC, tatweel/diacritics, Arabic orthography, whitespace, case) and
// the area > village > city priority order.
import { describe, expect, it } from "vitest";
import {
  deliveryLocalityKeys,
  normalizeDeliveryLocality,
} from "../delivery-zone";

describe("normalizeDeliveryLocality", () => {
  it("returns null for blank or missing input (never an empty key)", () => {
    expect(normalizeDeliveryLocality(null)).toBeNull();
    expect(normalizeDeliveryLocality(undefined)).toBeNull();
    expect(normalizeDeliveryLocality("")).toBeNull();
    expect(normalizeDeliveryLocality("   ")).toBeNull();
  });

  it("unifies Arabic orthographic variants (أ إ آ ٱ → ا, ى → ي, ة → ه)", () => {
    expect(normalizeDeliveryLocality("أحمد")).toBe("احمد");
    expect(normalizeDeliveryLocality("إبراهيم")).toBe("ابراهيم");
    expect(normalizeDeliveryLocality("آمنة")).toBe("امنه");
    expect(normalizeDeliveryLocality("ٱلله")).toBe("الله");
    expect(normalizeDeliveryLocality("المعادى")).toBe("المعادي");
    expect(normalizeDeliveryLocality("المنصورة")).toBe("المنصوره");
  });

  it("strips tatweel and diacritics", () => {
    expect(normalizeDeliveryLocality("مُحَمَّد")).toBe("محمد");
    expect(normalizeDeliveryLocality("مـــدينة")).toBe("مدينه");
  });

  it("collapses whitespace, trims, and lowercases", () => {
    expect(normalizeDeliveryLocality("  New   Cairo  ")).toBe("new cairo");
    expect(normalizeDeliveryLocality("مدينة   نصر")).toBe("مدينه نصر");
  });

  it("applies NFKC compatibility normalization", () => {
    // Arabic presentation forms and full-width Latin fold to their base forms.
    expect(normalizeDeliveryLocality("ﻣﺪﻳﻨﺔ")).toBe("مدينه");
    expect(normalizeDeliveryLocality("ＣＡＩＲＯ")).toBe("cairo");
  });
});

describe("deliveryLocalityKeys", () => {
  it("orders area > village > city and drops duplicates after normalization", () => {
    expect(
      deliveryLocalityKeys({ city: "القاهرة", village: "المعادي", area: "المعادي" }),
    ).toEqual([
      { field: "area", key: "المعادي" },
      { field: "city", key: "القاهره" },
    ]);
  });

  it("skips blank fields and returns an empty list without an address", () => {
    expect(deliveryLocalityKeys({ city: "  ", area: null, village: undefined })).toEqual([]);
    expect(deliveryLocalityKeys(null)).toEqual([]);
  });

  it("keeps city when no area/village is present", () => {
    expect(deliveryLocalityKeys({ city: "الجيزة" })).toEqual([
      { field: "city", key: "الجيزه" },
    ]);
  });
});
