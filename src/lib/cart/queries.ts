// BA-5 cart read domain.
//
// Owner resolution is exact: guest carts by stored session hash, customer
// carts by customer id — ACTIVE and UNEXPIRED rows only (terminal or
// expired carts are never operable; expired guest carts behave as absent
// so callers 404 or mint fresh — BA-A guest-expiry contract). The expiry
// gate is SQL now() (never a JS clock on decoded timestamps — CC-1 rule).
// Variant sale context is variant-liveness only, mirroring the frozen
// verification doubles (checkout + merge check the variant row;
// product-level gating lives in listings, not line validation).
import { prisma } from "@/lib/db";

export type CartOwner =
  | { kind: "guest"; sessionHash: string }
  | { kind: "customer"; customerId: string };

export async function findActiveCartByOwner(owner: CartOwner): Promise<{ id: string } | null> {
  const rows =
    owner.kind === "guest"
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM carts
           WHERE status = 'ACTIVE' AND session_id = ${owner.sessionHash}
             AND (expires_at IS NULL OR expires_at > now())
           ORDER BY created_at DESC LIMIT 1`
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM carts
           WHERE status = 'ACTIVE' AND customer_id = ${owner.customerId}::uuid
             AND (expires_at IS NULL OR expires_at > now())
           ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
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
