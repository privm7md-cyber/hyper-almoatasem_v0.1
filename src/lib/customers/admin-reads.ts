// ADM-06 customer read helpers (admin).
//
// The customers list needs three facts the customer row itself does not carry:
// how many orders the customer has, what those orders were worth, and where
// the last one was delivered. They are read in ONE query for the whole page
// (never one query per customer) and they describe ONLY the orders that are
// actually linked to the customer — a guest order is never attached to a
// customer account after the fact.
//
// Cancelled orders are excluded from the money total: a cancelled order was
// never collected, so it never counts as a customer total.

import "server-only";

import { prisma } from "@/lib/db";

export interface CustomerOrderSummary {
  /** Orders linked to the customer, including cancelled ones. */
  orderCount: number;
  /** Sum of the collected/estimated totals of the orders that were not cancelled. */
  total: string;
  /** When the last order was placed. */
  lastOrderAt: Date | null;
  /** The area of the last order that carried one. */
  lastArea: string | null;
}

/**
 * The order facts for the customers on the current page. One query for the
 * whole page; a customer with no orders is simply absent from the map.
 */
export async function customerOrderSummaries(
  customerIds: string[],
): Promise<Map<string, CustomerOrderSummary>> {
  const map = new Map<string, CustomerOrderSummary>();
  if (customerIds.length === 0) return map;
  const rows = await prisma.$queryRaw<
    Array<{
      customerId: string;
      orderCount: number;
      total: string;
      lastOrderAt: Date | null;
      lastArea: string | null;
    }>
  >`
    SELECT o.customer_id::text AS "customerId",
      COUNT(*)::int AS "orderCount",
      COALESCE(SUM(CASE WHEN o.status <> 'CANCELLED'
        THEN COALESCE(o.total_final, o.total_estimated) ELSE 0 END), 0)::text AS "total",
      MAX(o.created_at) AS "lastOrderAt",
      (SELECT o2.delivery_area FROM orders o2
        WHERE o2.customer_id = o.customer_id AND o2.delivery_area IS NOT NULL
        ORDER BY o2.created_at DESC LIMIT 1) AS "lastArea"
    FROM orders o
    WHERE o.customer_id = ANY(${customerIds}::uuid[])
    GROUP BY o.customer_id`;
  for (const row of rows) {
    map.set(row.customerId, {
      orderCount: row.orderCount,
      total: row.total,
      lastOrderAt: row.lastOrderAt,
      lastArea: row.lastArea,
    });
  }
  return map;
}
