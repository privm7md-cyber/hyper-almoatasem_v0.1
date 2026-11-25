import { describe, expect, it } from "vitest";
import {
  actorTypeLabel,
  canCustomerCancel,
  canDecideReplacement,
  formatMoney,
  formatOrderTimestamp,
  formatQuantity,
  itemStatusLabel,
  normalizeQuantity,
  orderStatusLabel,
  quantitiesEqual,
  replacementStatusLabel,
  unitLabel,
} from "@/lib/orders/display";

describe("order display labels", () => {
  it("maps every frozen order status and never leaks an unknown code", () => {
    expect(orderStatusLabel("NEW")).toBe("تم استلام طلبك");
    expect(orderStatusLabel("PREPARING")).toBe("جاري تجهيز طلبك");
    expect(orderStatusLabel("CANCELLED")).toBe("تم إلغاء الطلب");
    expect(orderStatusLabel("SOMETHING_ELSE")).toBe("حالة غير معروفة");
  });

  it("maps item, replacement and actor enums with explicit unknowns", () => {
    expect(itemStatusLabel("PARTIALLY_FULFILLED")).toBe("مكتمل جزئيًا");
    expect(itemStatusLabel("X")).toBe("حالة غير معروفة");
    expect(replacementStatusLabel("AUTO_ACCEPTED")).toBe("مقبول تلقائيًا");
    expect(replacementStatusLabel("X")).toBe("حالة غير معروفة");
    expect(actorTypeLabel("GUEST")).toBe("الضيف");
    expect(actorTypeLabel("X")).toBe("جهة غير معروفة");
  });

  it("maps units without inventing one", () => {
    expect(unitLabel("KG")).toBe("كجم");
    expect(unitLabel("PIECE")).toBe("قطعة");
    expect(unitLabel("TON")).toBe("TON");
  });
});

describe("quantity and money formatting", () => {
  it("keeps WEIGHT at the schema's 3-decimal precision", () => {
    expect(formatQuantity("0.5", "WEIGHT")).toBe("0.500");
    expect(formatQuantity("1.250", "WEIGHT")).toBe("1.250");
  });

  it("renders PIECE whole packs without trailing zeros", () => {
    expect(formatQuantity("1.000", "PIECE")).toBe("1");
    expect(formatQuantity("2.000", "PIECE")).toBe("2");
    expect(formatQuantity("2.500", "PIECE")).toBe("2.500");
  });

  it("never turns a missing or malformed quantity into zero", () => {
    expect(formatQuantity(null, "WEIGHT")).toBe("غير متاح");
    expect(formatQuantity("", "PIECE")).toBe("غير متاح");
    expect(formatQuantity("abc", "WEIGHT")).toBe("abc");
  });

  it("passes backend money through at exactly two decimals", () => {
    expect(formatMoney("0.00")).toBe("0.00 ج.م");
    expect(formatMoney("240")).toBe("240.00 ج.م");
    expect(formatMoney("1234.5")).toBe("1234.50 ج.م");
    expect(formatMoney("1234.50")).toBe("1234.50 ج.م");
    expect(formatMoney("1.234")).toBe("1.234 ج.م");
    expect(formatMoney("غير متاح")).toBe("غير متاح ج.م");
  });

  it("passes an invalid timestamp through instead of inventing a date", () => {
    expect(formatOrderTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("decimal precision (NUMERIC(12,3) without float arithmetic)", () => {
  it("normalizes a decimal string without touching a float", () => {
    expect(normalizeQuantity("0.250")).toBe("0.25");
    expect(normalizeQuantity("1.250")).toBe("1.25");
    expect(normalizeQuantity("0.125")).toBe("0.125");
    expect(normalizeQuantity("0001.250")).toBe("1.25");
    expect(normalizeQuantity("2.")).toBe("2");
    expect(normalizeQuantity("-0.500")).toBe("-0.5");
    expect(normalizeQuantity("-0.000")).toBe("0");
  });

  it("rejects a malformed value instead of coercing it to zero", () => {
    expect(normalizeQuantity(null)).toBeNull();
    expect(normalizeQuantity(undefined)).toBeNull();
    expect(normalizeQuantity("")).toBeNull();
    expect(normalizeQuantity("abc")).toBeNull();
    expect(normalizeQuantity("1,250")).toBeNull();
    expect(normalizeQuantity("1.2.3")).toBeNull();
  });

  it("compares the mandated quantities exactly", () => {
    // 0.125 / 0.250 / 1.250 are the values the mandate names: a float
    // comparison of 0.1 + 0.025 style sums is not used anywhere here.
    expect(quantitiesEqual("0.250", "0.25")).toBe(true);
    expect(quantitiesEqual("0.250", "0.250")).toBe(true);
    expect(quantitiesEqual("1.250", "1.25")).toBe(true);
    expect(quantitiesEqual("0.125", "0.125")).toBe(true);
    expect(quantitiesEqual("0.125", "0.250")).toBe(false);
    expect(quantitiesEqual("1.250", "0.250")).toBe(false);
  });

  it("does not report a difference for trailing zeros only", () => {
    // The order detail page decides "الكمية الفعلية تختلف عن المطلوبة"
    // from these two strings; 2.000 vs 2 must NOT be flagged as a change.
    expect(quantitiesEqual("2.000", "2")).toBe(true);
    expect(quantitiesEqual("0.000", "0")).toBe(true);
    expect(quantitiesEqual("10.000", "10.00")).toBe(true);
    expect(quantitiesEqual("1.001", "1.000")).toBe(false);
  });

  it("treats an unknown value as unequal rather than equal", () => {
    expect(quantitiesEqual(null, null)).toBe(false);
    expect(quantitiesEqual("abc", "abc")).toBe(false);
    expect(quantitiesEqual("1.000", null)).toBe(false);
  });

  it("keeps the PIECE and WEIGHT rendering rules apart", () => {
    expect(formatQuantity("0.250", "WEIGHT")).toBe("0.250");
    expect(formatQuantity("0.25", "WEIGHT")).toBe("0.250");
    expect(formatQuantity("1.250", "WEIGHT")).toBe("1.250");
    expect(formatQuantity("1.250", "PIECE")).toBe("1.250");
    expect(formatQuantity("1.000", "PIECE")).toBe("1");
    expect(formatQuantity("0.125", "PIECE")).toBe("0.125");
  });
});

describe("customer action eligibility", () => {
  it("allows cancel only in NEW/CONFIRMED/PREPARING with no picked line", () => {
    expect(canCustomerCancel({ status: "NEW", items: [{ actualQuantity: null }] })).toBe(true);
    expect(canCustomerCancel({ status: "CONFIRMED", items: [] })).toBe(true);
    expect(canCustomerCancel({ status: "PREPARING", items: [{ actualQuantity: null }] })).toBe(true);
    expect(canCustomerCancel({ status: "PREPARING", items: [{ actualQuantity: "1.000" }] })).toBe(false);
    expect(canCustomerCancel({ status: "READY_FOR_DELIVERY", items: [] })).toBe(false);
    expect(canCustomerCancel({ status: "DELIVERED", items: [] })).toBe(false);
    expect(canCustomerCancel({ status: "CANCELLED", items: [] })).toBe(false);
  });

  it("offers a replacement decision only when the backend would accept it", () => {
    const base = {
      orderStatus: "CONFIRMED",
      replacementStatus: "PROPOSED",
      originalItemStatus: "PENDING",
      originalActualQuantity: null,
    };
    expect(canDecideReplacement(base)).toBe(true);
    expect(canDecideReplacement({ ...base, orderStatus: "PREPARING" })).toBe(true);
    expect(canDecideReplacement({ ...base, orderStatus: "READY_FOR_DELIVERY" })).toBe(false);
    expect(canDecideReplacement({ ...base, replacementStatus: "CUSTOMER_APPROVED" })).toBe(false);
    expect(canDecideReplacement({ ...base, originalItemStatus: "FULFILLED" })).toBe(false);
    expect(canDecideReplacement({ ...base, originalActualQuantity: "0.900" })).toBe(false);
  });
});
