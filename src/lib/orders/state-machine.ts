// BA-6 order state machine (pure, no DB, no server-only).
//
// Exact frozen names from db/phase2-schema.sql (chk_orders_status +
// chk_history_transition): NEW, CONFIRMED, PREPARING, READY_FOR_DELIVERY,
// OUT_FOR_DELIVERY, DELIVERED, CANCELLED. No other state exists; the DB
// triggers/CHECKs remain authoritative — this module lets the domain fail
// fast with 409 before touching SQL. BA-6 drives NEW→CONFIRMED (creation)
// and NEW|CONFIRMED→CANCELLED (unpicked-only cancel); picking-gated and
// fulfillment transitions belong to later phases.

export const ORDER_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed NEXT states per CURRENT state (frozen transition table). */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_DELIVERY", "CANCELLED"],
  READY_FOR_DELIVERY: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  const next = (TRANSITIONS as Record<string, readonly string[]>)[from];
  return next !== undefined && next.includes(to);
}

export function isTerminal(status: string): boolean {
  return status === "DELIVERED" || status === "CANCELLED";
}

/** BA-6 cancel policy: unpicked orders only. Picking (actual quantities)
 * belongs to fulfillment; cancelling picked lines needs restock movements
 * that phase will own. NEW|CONFIRMED rows are always unpicked by
 * construction (actuals are PREPARING-only writes). */
export function canCancelInBa6(status: string): boolean {
  return status === "NEW" || status === "CONFIRMED";
}

/** HM-YYYYMMDD-###### from SQL clock parts (gaps OK). Pure formatter;
 * the sequence value + date both come from PostgreSQL (CC-1 rule: no JS
 * clock in authoritative identifiers). */
export function formatOrderNumber(dateYYYYMMDD: string, seq: number): string {
  return `HM-${dateYYYYMMDD}-${String(seq).padStart(6, "0")}`;
}
