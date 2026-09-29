// BA-7 replacement serialization (boundary shapes).
//
// Decimals as exact strings (Prisma Decimal toString — numerically exact).
// Embeds the original-line summary and substitute summary from frozen
// snapshots/rows (never live catalog prices beyond the frozen proposal
// price, which IS the stored replacement_unit_price). No auth secrets,
// no inventory internals.
import type { OrderItem, OrderItemReplacement, Prisma, Product, ProductVariant } from "@prisma/client";

const decReq = (v: Prisma.Decimal): string => v.toString();

export interface ReplacementLineSummary {
  orderItemId: string;
  variantName: string;
  productName: string;
  requestedQuantity: string;
  itemStatus: string;
}

type ItemRow = OrderItem & {
  variant: ProductVariant & { product: Pick<Product, "name"> };
};

function toLineSummary(i: ItemRow): ReplacementLineSummary {
  return {
    orderItemId: i.id,
    variantName: i.variantNameSnapshot,
    productName: i.productNameSnapshot,
    requestedQuantity: i.requestedQuantity.toString(),
    itemStatus: i.itemStatus,
  };
}

export interface SubstituteSummary {
  variantId: string;
  variantName: string;
  productName: string;
}

type VariantRow = ProductVariant & { product: Pick<Product, "name"> };

export interface ReplacementShape {
  id: string;
  orderId: string;
  original: ReplacementLineSummary;
  substitute: SubstituteSummary;
  replacementQuantity: string;
  replacementUnitPrice: string;
  priceDifference: string;
  reason: string | null;
  status: string;
  proposedByType: string;
  decidedByType: string | null;
  replacementOrderItemId: string | null;
  createdAt: string;
}

type ReplacementRow = OrderItemReplacement & {
  originalItem: ItemRow;
  replacementVariant: VariantRow;
};

export function toReplacement(r: ReplacementRow): ReplacementShape {
  return {
    id: r.id,
    orderId: r.originalItem.orderId,
    original: toLineSummary(r.originalItem),
    substitute: {
      variantId: r.replacementVariantId,
      variantName: r.replacementVariant.name,
      productName: r.replacementVariant.product.name,
    },
    replacementQuantity: decReq(r.replacementQuantity),
    replacementUnitPrice: decReq(r.replacementUnitPrice),
    priceDifference: decReq(r.priceDifference),
    reason: r.reason,
    status: r.status,
    proposedByType: r.proposedByType,
    decidedByType: r.decidedByType,
    replacementOrderItemId: r.replacementOrderItemId,
    createdAt: r.createdAt.toISOString(),
  };
}
