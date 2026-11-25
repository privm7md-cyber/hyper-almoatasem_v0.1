// BA-7 replacement serialization (boundary shapes).
//
// Decimals as exact strings (Prisma Decimal toString — numerically exact).
// Embeds the original-line summary and substitute summary from frozen
// snapshots/rows (never live catalog prices beyond the frozen proposal
// price, which IS the stored replacement_unit_price). No auth secrets,
// no inventory internals.
import type { OrderItem, OrderItemReplacement, Product, ProductVariant } from "@prisma/client";
import { decReq } from "@/lib/api/serialize";
import { parseStoredAlternativesEnvelope } from "@/lib/replacements/validation";

export interface ReplacementLineSummary {
  orderItemId: string;
  variantName: string;
  productName: string;
  requestedQuantity: string;
  itemStatus: string;
  /** Unit of the requested line (snapshot) — display-only, never a price basis. */
  unitSnapshot: string;
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
    unitSnapshot: i.unitSnapshot,
  };
}

export interface SubstituteSummary {
  variantId: string;
  variantName: string;
  productName: string;
  /** Counting unit from the frozen variant/product row (never invented). */
  unit: string;
  productType: string;
}

type VariantRow = ProductVariant & { product: Pick<Product, "name" | "unit" | "productType"> };

export interface AlternativeCard {
  variantId: string;
  variantName: string;
  productName: string;
  sizeValue: string | null;
  unit: string;
  productType: string;
  quantity: string;
  price: string;
  priceDifference: string;
  reason: string | null;
  /** Owner: customer picked this one (alt 0 while approved). */
  chosen: boolean;
  status: string;
}

export interface ReplacementShape {
  id: string;
  orderId: string;
  original: ReplacementLineSummary;
  substitute: SubstituteSummary;
  /** Owner: multi-alternative cards (alt #0 mirrors the singular columns). */
  alternatives: AlternativeCard[];
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

function toAlternatives(r: ReplacementRow): AlternativeCard[] {
  const envelope = parseStoredAlternativesEnvelope(r.reason);
  const stored = envelope?.alternatives ?? [];
  const singular: AlternativeCard = {
    variantId: r.replacementVariantId,
    variantName: r.originalItem.variantNameSnapshot,
    productName: r.originalItem.productNameSnapshot,
    sizeValue: r.replacementVariant.sizeValue?.toString() ?? null,
    unit: r.originalItem.unitSnapshot,
    productType: r.originalItem.productTypeSnapshot,
    quantity: decReq(r.replacementQuantity),
    price: decReq(r.replacementUnitPrice),
    priceDifference: decReq(r.priceDifference),
    reason: r.reason ?? null,
    chosen: r.status === "CUSTOMER_APPROVED",
    status: r.status,
  };
  if (stored.length === 0) return [singular];
  // Owner: cards from the stored multi-alternative JSON (alt #0 = singular cols).
  return stored.map((alt, i) => ({
    variantId: alt.variantId,
    variantName: alt.variantName ?? (i === 0 ? r.replacementVariant.name : `بديل #${i + 1}`),
    productName: alt.productName ?? (i === 0 ? r.replacementVariant.product.name : `البديل #${i + 1}`),
    sizeValue: alt.sizeValue ?? (i === 0 ? r.replacementVariant.sizeValue?.toString() ?? null : null),
    unit: alt.unit ?? (i === 0 ? r.replacementVariant.sizeUnit ?? r.replacementVariant.product.unit : r.originalItem.unitSnapshot),
    productType: alt.productType ?? (i === 0 ? r.replacementVariant.product.productType : r.originalItem.productTypeSnapshot),
    quantity: decReqStr(alt.quantity),
    price: decReqStr(alt.price),
    priceDifference: decReqStr(alt.priceDifference),
    reason: alt.reason,
    chosen: envelope?.chosenIndex === i && r.status === "CUSTOMER_APPROVED",
    status: r.status,
  }));
}

function decReqStr(v: string | null | undefined): string {
  return v === null || v === undefined || v === "" ? "" : String(v);
}

export function toReplacement(r: ReplacementRow): ReplacementShape {
  const envelope = parseStoredAlternativesEnvelope(r.reason);
  return {
    id: r.id,
    orderId: r.originalItem.orderId,
    original: toLineSummary(r.originalItem),
    substitute: {
      variantId: r.replacementVariantId,
      variantName: r.replacementVariant.name,
      productName: r.replacementVariant.product.name,
      unit: r.replacementVariant.sizeUnit ?? r.replacementVariant.product.unit,
      productType: r.replacementVariant.product.productType,
    },
    alternatives: toAlternatives(r),
    replacementQuantity: decReq(r.replacementQuantity),
    replacementUnitPrice: decReq(r.replacementUnitPrice),
    priceDifference: decReq(r.priceDifference),
    reason: envelope ? envelope.proposalReason : r.reason,
    status: r.status,
    proposedByType: r.proposedByType,
    decidedByType: r.decidedByType,
    replacementOrderItemId: r.replacementOrderItemId,
    createdAt: r.createdAt.toISOString(),
  };
}
