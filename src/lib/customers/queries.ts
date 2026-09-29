// BA-4 customer read domain (Prisma queries only, no writes).
//
// Admin reads take explicit filters; the public identify flow uses
// findByPhone as its fast-path lookup (the write path re-arbitrates on
// UNIQUE, so this read is never a correctness gate). No read here exposes
// password_hash (omitted by construction in serialize.ts).
import { prisma } from "@/lib/db";

export interface CustomerListFilter {
  limit: number;
  cursor: string | null;
  search: string | null;
  registered: boolean | null;
  active: boolean | null;
}

export async function listCustomers(filter: CustomerListFilter) {
  return prisma.customer.findMany({
    where: {
      ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      ...(filter.search
        ? {
            OR: [
              { phone: { contains: filter.search } },
              { firstName: { contains: filter.search, mode: "insensitive" as const } },
              { lastName: { contains: filter.search, mode: "insensitive" as const } },
              { email: { contains: filter.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(filter.registered === null || filter.registered === undefined
        ? {}
        : { isRegistered: filter.registered }),
      ...(filter.active === null || filter.active === undefined ? {} : { isActive: filter.active }),
    },
    orderBy: [{ id: "asc" as const }],
    take: filter.limit + 1,
  });
}

export function getCustomer(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      addresses: { orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }] },
    },
  });
}

/** Canonical-phone lookup (UNIQUE). Fast path for identify; the UNIQUE
 * constraint (not this read) arbitrates concurrent creates. */
export function findCustomerByPhone(canonicalPhone: string) {
  return prisma.customer.findUnique({ where: { phone: canonicalPhone } });
}

export function listAddressesByCustomer(customerId: string) {
  return prisma.customerAddress.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }],
  });
}

/** Scoped address read: 404 unless the address belongs to the customer
 * (never leaks cross-customer existence). */
export function getAddressOfCustomer(customerId: string, addressId: string) {
  return prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
}
