// BA-5 cart read domain (Prisma queries only, no writes).
//
// Owner resolution is exact: guest carts by stored session hash, customer
// carts by customer id — ACTIVE rows only (terminal carts are never
// operable). Variant sale context is variant-liveness only, mirroring the
// frozen verification doubles (checkout + merge check the variant row;
// product-level gating lives in listings, not line validation).
import { prisma } from "@/lib/db";

export type CartOwner =
  | { kind: "guest"; sessionHash: string }
  | { kind: "customer"; customerId: string };

export function findActiveCartByOwner(owner: CartOwner) {
  return prisma.cart.findFirst({
    where: {
      status: "ACTIVE",
      ...(owner.kind === "guest" ? { sessionId: owner.sessionHash } : { customerId: owner.customerId }),
    },
    select: { id: true },
  });
}

export function getCartFull(cartId: string) {
  return prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          variant: {
            include: { product: { select: { id: true, name: true, productType: true } } },
          },
        },
        orderBy: [{ id: "asc" as const }],
      },
    },
  });
}

/** Live sale context for line validation (price basis + counting unit +
 * step rule inputs + liveness). Returns null for unknown variants. */
export function getVariantSaleContext(variantId: string) {
  return prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      name: true,
      sizeUnit: true,
      price: true,
      isActive: true,
      deletedAt: true,
      product: {
        select: {
          id: true,
          productType: true,
          saleStepGrams: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
  });
}

export type VariantSaleContext = NonNullable<Awaited<ReturnType<typeof getVariantSaleContext>>>;
