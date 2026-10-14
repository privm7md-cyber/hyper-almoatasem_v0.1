// FE-7 order reads (server-only): dual-policy detail + session list for RSC pages.
// Session path: ownership query (foreign reads null → masked NOT_FOUND). Guest path: order-bound
// credential cookie (FP03-G1 adapter persistence) via requireGuestOrder on a synthetic request.
// Raw secrets never leave this module; error codes mirror the backend routes.

import "server-only";

import { cookies } from "next/headers";
import { ApiError } from "@/lib/api/errors";
import { requireCustomer } from "@/lib/customers/session";
import { getCustomerOrder, listCustomerOrders } from "@/lib/orders/queries";
import { GUEST_ORDER_TOKEN_HEADER, requireGuestOrder } from "@/lib/orders/guest-access";
import {
  listReplacementsForCustomerOrder,
  listReplacementsForGuestOrder,
} from "@/lib/replacements/queries";
import { toOrder, toOrderListItem, type OrderShape } from "@/lib/orders/serialize";
import { toReplacement, type ReplacementShape } from "@/lib/replacements/serialize";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUEST_COOKIE_PREFIX = "__Host-guest-order-";

export type OrderAccessError = "INVALID_ID" | "UNAUTHENTICATED" | "RATE_LIMITED" | "GONE" | "NOT_FOUND";

export interface OrderDetail {
  order: OrderShape;
  replacements: ReplacementShape[];
  via: "session" | "guest";
}

function probe(headers: Record<string, string>): Request {
  return new Request("http://localhost/", { headers });
}

async function sessionCookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .filter((c) => !c.name.startsWith(GUEST_COOKIE_PREFIX))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function toAccessError(error: unknown): OrderAccessError {
  if (error instanceof ApiError) {
    if (error.code === "GONE") return "GONE";
    if (error.code === "UNAUTHENTICATED") return "UNAUTHENTICATED";
    if (error.code === "RATE_LIMITED") return "RATE_LIMITED";
    return "NOT_FOUND";
  }
  return "NOT_FOUND";
}

/** Dual-policy single-order read. */
export async function getOrderDetail(orderId: string): Promise<OrderDetail | { error: OrderAccessError }> {
  if (!UUID_RE.test(orderId)) return { error: "INVALID_ID" };
  const cookie = await sessionCookieHeader();
  if (cookie !== "") {
    try {
      const me = await requireCustomer(probe({ cookie }));
      const row = await getCustomerOrder(orderId, me.customerId);
      // Valid session that does not own this order: masked NOT_FOUND (no guest fall-through —
      // existence must not leak, and sessions never borrow guest credentials).
      if (!row) return { error: "NOT_FOUND" };
      const replacements = (await listReplacementsForCustomerOrder(orderId, me.customerId).catch(() => null)) ?? [];
      return { order: toOrder(row), replacements: replacements.map(toReplacement), via: "session" };
    } catch (error) {
      // No usable session (expired/invalid): fall through to the guest path.
      if (error instanceof ApiError && error.code === "RATE_LIMITED") return { error: "RATE_LIMITED" };
    }
  }
  const jar = await cookies();
  const credential = jar.get(`${GUEST_COOKIE_PREFIX}${orderId.toLowerCase()}`);
  if (!credential) return { error: "UNAUTHENTICATED" };
  try {
    const full = await requireGuestOrder(probe({ [GUEST_ORDER_TOKEN_HEADER]: credential.value }), orderId);
    const replacements = (await listReplacementsForGuestOrder(orderId).catch(() => null)) ?? [];
    return { order: toOrder(full), replacements: replacements.map(toReplacement), via: "guest" };
  } catch (error) {
    return { error: toAccessError(error) };
  }
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  total: string;
  createdAt: string;
}

/** Session-owned order list (newest-first, first page). Guests have no list (contract). */
export async function listMyOrders(): Promise<OrderListItem[] | null> {
  const cookie = await sessionCookieHeader();
  if (cookie === "") return null;
  try {
    const me = await requireCustomer(probe({ cookie }));
    const rows = await listCustomerOrders({ customerId: me.customerId, limit: 20, cursor: null });
    return rows.slice(0, 20).map((r) => {
      const item = toOrderListItem(r, r._count.items);
      return {
        id: item.id,
        orderNumber: item.orderNumber,
        status: item.status,
        total: item.totalFinal ?? item.totalEstimated,
        createdAt: item.createdAt,
      };
    });
  } catch {
    return null;
  }
}
