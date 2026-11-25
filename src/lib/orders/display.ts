// Order display mapping (pure, no DB, no server-only).
//
// One source for the Arabic labels of the frozen backend enums and for the
// client-visible eligibility rules. Nothing here invents a state, an ETA, a
// weight, or a support channel: unknown values render an explicit unknown
// label and the action rules mirror the backend domain (lib/orders/writes.ts,
// lib/replacements/writes.ts) without widening them.

import type { OrderItemShape } from "@/lib/orders/serialize";

export const ORDER_STATUS_LABELS: Record<string, string> = {
  NEW: "تم استلام طلبك",
  CONFIRMED: "تم تأكيد الطلب",
  PREPARING: "جاري تجهيز طلبك",
  READY_FOR_DELIVERY: "طلبك جاهز",
  OUT_FOR_DELIVERY: "طلبك خرج للتوصيل",
  DELIVERED: "تم تسليم الطلب",
  CANCELLED: "تم إلغاء الطلب",
};

export const ITEM_STATUS_LABELS: Record<string, string> = {
  PENDING: "قيد الانتظار",
  FULFILLED: "مكتمل",
  PARTIALLY_FULFILLED: "مكتمل جزئيًا",
  UNAVAILABLE: "غير متوفر",
  REPLACED: "مستبدل",
  CANCELLED: "ملغي",
};

export const REPLACEMENT_STATUS_LABELS: Record<string, string> = {
  PROPOSED: "بانتظار قرارك",
  CUSTOMER_APPROVED: "مقبول",
  CUSTOMER_REJECTED: "مرفوض",
  AUTO_ACCEPTED: "مقبول تلقائيًا",
};

export const ACTOR_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "العميل",
  GUEST: "الضيف",
  STAFF: "المتجر",
  SYSTEM: "النظام",
};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "قطعة",
  KG: "كجم",
  GRAM: "جم",
  LITER: "لتر",
  ML: "مل",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? "حالة غير معروفة";
}

export function itemStatusLabel(status: string): string {
  return ITEM_STATUS_LABELS[status] ?? "حالة غير معروفة";
}

export function replacementStatusLabel(status: string): string {
  return REPLACEMENT_STATUS_LABELS[status] ?? "حالة غير معروفة";
}

export function actorTypeLabel(actorType: string): string {
  return ACTOR_TYPE_LABELS[actorType] ?? "جهة غير معروفة";
}

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

/**
 * Canonical form of a decimal quantity: no leading zeros, no trailing
 * fraction zeros. Two quantities are the SAME number iff their canonical
 * forms match — "0.250" and "0.25" canonicalize to "0.25", "1.250" to "1.25".
 * A value that is not a plain decimal (exponent form, junk, more than the
 * schema's 3 fraction digits) yields null: it is never guessed at.
 */
export function normalizeQuantity(quantity: string | null | undefined): string | null {
  if (quantity == null) return null;
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(quantity.trim());
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const negative = match[1] === "-" && !(integer === "0" && fraction === "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Exact equality of two decimal quantities, compared as decimals — never as
 * binary floats. The backend stores quantities as NUMERIC(12,3): a float
 * comparison of "0.125", "0.250" and "1.250" is only accidentally right, and
 * it silently rounds a value that is not representable. An unknown value
 * (null / non-decimal) is never "equal" to anything.
 */
export function quantitiesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeQuantity(a);
  const nb = normalizeQuantity(b);
  if (na === null || nb === null) return false;
  return na === nb;
}

/**
 * Quantity rendering at the schema's own precision. WEIGHT quantities are
 * NUMERIC(12,3) and stay at 3 decimals; PIECE quantities are whole packs and
 * render without `.000`. A malformed value is shown as-is — never coerced to 0
 * and never silently rounded.
 */
export function formatQuantity(quantity: string | null | undefined, productType: string): string {
  if (quantity == null || quantity === "") return "غير متاح";
  const canonical = normalizeQuantity(quantity);
  if (canonical === null) return quantity;
  if (productType === "WEIGHT") {
    const [integer, fraction = ""] = canonical.split(".");
    return `${integer}.${fraction.padEnd(3, "0")}`;
  }
  if (productType === "PIECE") {
    // A whole pack renders as a whole number; a non-whole PIECE value is
    // shown verbatim (it is not a valid pack, and it must not be rounded).
    return canonical.includes(".") ? quantity : canonical;
  }
  return quantity;
}

/** Backend timestamps are ISO strings; invalid values are shown verbatim. */
export function formatOrderTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(date);
}

/**
 * Money is an exact decimal string from the backend. The backend may drop
 * trailing zeros ("240"), so the display pins exactly two decimals without
 * ever recomputing the amount. A value with more than two decimals is shown
 * verbatim rather than silently rounded.
 */
export function formatMoney(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return `${value} ج.م`;
  const fraction = match[3] ?? "";
  if (fraction.length > 2) return `${value} ج.م`;
  return `${match[1]}${match[2]}.${fraction.padEnd(2, "0")} ج.م`;
}

export interface CancelEligibilityOrder {
  status: string;
  items: ReadonlyArray<Pick<OrderItemShape, "actualQuantity">>;
}

/**
 * Same rule as cancelOrder(): NEW|CONFIRMED|PREPARING and every line unpicked.
 * PREPARING is included because the backend includes it, but a picked line
 * (actual quantity present) always answers 409 — so the button is not offered.
 */
export function canCustomerCancel(order: CancelEligibilityOrder): boolean {
  if (order.status !== "NEW" && order.status !== "CONFIRMED" && order.status !== "PREPARING") {
    return false;
  }
  return order.items.every((item) => item.actualQuantity === null);
}

export interface DecideEligibility {
  orderStatus: string;
  replacementStatus: string;
  originalItemStatus: string;
  originalActualQuantity: string | null | undefined;
}

/**
 * Same rule as decideReplacement(): open proposal, workable order state
 * (CONFIRMED|PREPARING), and an original line still PENDING|UNAVAILABLE with
 * no picked actual. Anything else answers 409 and must not be offered.
 */
export function canDecideReplacement(args: DecideEligibility): boolean {
  return (
    args.replacementStatus === "PROPOSED" &&
    (args.orderStatus === "CONFIRMED" || args.orderStatus === "PREPARING") &&
    (args.originalItemStatus === "PENDING" || args.originalItemStatus === "UNAVAILABLE") &&
    args.originalActualQuantity === null
  );
}

const MUTATION_ERROR_MESSAGES: Record<string, string> = {
  CONFLICT: "لم يعد الإجراء متاحًا لحالة الطلب الحالية. حدّث الحالة للمتابعة.",
  NOT_FOUND: "لم نتمكن من العثور على الطلب أو الاقتراح المطلوب.",
  UNAUTHENTICATED: "انتهت صلاحية الوصول أو لا تملك صلاحية هذا الإجراء.",
  GONE: "انتهت صلاحية الوصول إلى هذا الطلب.",
  FORBIDDEN: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  VALIDATION: "بيانات غير صالحة.",
  RATE_LIMITED: "عدد المحاولات كبير. حاول مرة أخرى بعد قليل.",
  TRANSPORT: "لم نتمكن من تأكيد نتيجة الإجراء بعد. جارٍ التحقق من الحالة.",
};

/** Arabic copy for a confirmed backend rejection (never a success claim). */
export function mutationErrorMessage(code: string): string {
  return MUTATION_ERROR_MESSAGES[code] ?? "تعذّر تنفيذ الإجراء. حاول مرة أخرى.";
}

