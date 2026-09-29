// BA-7 replacement read domain (Prisma queries only, no writes).
//
// Scoping is ownership-exact via the replacement → item → order chain:
// storefront callers always join through their own order+customer, so
// foreign replacements read as 404 (existence never leaked).
import { prisma } from "@/lib/db";

const variantGraph = {
  include: { product: { select: { name: true } } },
} as const;

const replacementGraph = {
  include: {
    originalItem: {
      include: {
        variant: variantGraph,
        order: { select: { id: true, customerId: true, status: true } },
      },
    },
    replacementVariant: variantGraph,
  },
};

export function getReplacement(id: string) {
  return prisma.orderItemReplacement.findUnique({
    where: { id },
    include: {
      originalItem: {
        include: {
          variant: variantGraph,
          order: { select: { id: true, customerId: true, status: true } },
        },
      },
      replacementVariant: variantGraph,
    },
  });
}

/** Storefront list: replacements of one owned order (order+customer gate
 * in a single query — foreign orders yield an empty list). */
export async function listReplacementsForCustomerOrder(orderId: string, customerId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    select: { id: true },
  });
  if (!order) return null;
  return prisma.orderItemReplacement.findMany({
    where: { originalItem: { orderId } },
    ...replacementGraph,
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  });
}

/** Admin list: replacements of one order (order existence checked first). */
export async function listReplacementsByOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) return null;
  return prisma.orderItemReplacement.findMany({
    where: { originalItem: { orderId } },
    ...replacementGraph,
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  });
}

/** Live PROPOSED proposal for one line (partial-UQ companion read). */
export function findLiveProposal(orderItemId: string) {
  return prisma.orderItemReplacement.findFirst({
    where: { orderItemId, status: "PROPOSED" },
    select: { id: true },
  });
}

/** R2 gate inputs for one order (fulfillment-owned consumer). */
export async function getReadyGateInputs(orderId: string): Promise<{
  pendingPickable: number;
  liveProposed: number;
} | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) return null;
  const [pending, proposed] = await Promise.all([
    prisma.orderItem.count({ where: { orderId, itemStatus: "PENDING" } }),
    prisma.orderItemReplacement.count({
      where: { status: "PROPOSED", originalItem: { orderId } },
    }),
  ]);
  return { pendingPickable: pending, liveProposed: proposed };
}
