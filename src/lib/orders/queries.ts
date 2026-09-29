// BA-6 order read domain (Prisma queries only, no writes).
//
// All reads render snapshot columns (never live catalog joins). Scoping is
// ownership-exact: storefront callers filter by their own customer id;
// unknown-or-foreign ids read as 404 (existence never leaked).
import { prisma } from "@/lib/db";

export function getOrderFull(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: [{ id: "asc" as const }] },
      history: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
    },
  });
}

/** Ownership-scoped single read (storefront + cancel paths). */
export function getCustomerOrder(orderId: string, customerId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, customerId },
    include: {
      items: { orderBy: [{ id: "asc" as const }] },
      history: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
    },
  });
}

export interface CustomerOrderListFilter {
  limit: number;
  cursor: string | null;
  customerId: string;
}

/** Own orders, newest first (UUIDv7 ids are time-ordered — id DESC is a
 * stable newest-first cursor; tiebreak inherent). */
export async function listCustomerOrders(filter: CustomerOrderListFilter) {
  const rows = await prisma.order.findMany({
    where: {
      customerId: filter.customerId,
      ...(filter.cursor ? { id: { lt: filter.cursor } } : {}),
    },
    include: { _count: { select: { items: true } } },
    orderBy: [{ id: "desc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

export interface AdminOrderListFilter {
  limit: number;
  cursor: string | null;
  status: string | null;
  customerId: string | null;
  search: string | null;
}

export async function listOrdersAdmin(filter: AdminOrderListFilter) {
  const rows = await prisma.order.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.search ? { orderNumber: { contains: filter.search, mode: "insensitive" as const } } : {}),
    },
    include: { _count: { select: { items: true } } },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
  return rows;
}

/** Idempotency pre-check + replay lookup (UNIQUE key). */
export function findOrderByIdempotencyKey(key: string) {
  return prisma.order.findUnique({
    where: { idempotencyKey: key },
    include: {
      items: { orderBy: [{ id: "asc" as const }] },
      history: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
    },
  });
}

/** Same-cart replay lookup (cart CHECKED_OUT-once guard companion). */
export function findOrderByCart(cartId: string) {
  return prisma.order.findFirst({
    where: { cartId },
    include: {
      items: { orderBy: [{ id: "asc" as const }] },
      history: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
    },
    orderBy: [{ id: "asc" as const }],
  });
}
