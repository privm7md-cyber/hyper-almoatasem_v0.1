// BA-6 order serialization (boundary shapes).
//
// Historical reads use SNAPSHOT fields only — never live catalog prices,
// names, or inventory. Decimals as exact strings; money already exact from
// the writer (integer-piastres → "d.cc"). Exposes no inventory internals,
// no idempotency internals beyond the key echo, no auth secrets.
import type { Order, OrderItem, OrderStatusHistory, Prisma } from "@prisma/client";

const decReq = (v: Prisma.Decimal): string => v.toString();
const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);

export interface OrderItemShape {
  id: string;
  productVariantId: string;
  productName: string;
  variantName: string;
  brandName: string | null;
  productCode: string | null;
  codeType: string | null;
  unit: string;
  productType: string;
  saleStep: number | null;
  unitPrice: string;
  requestedQuantity: string;
  actualQuantity: string | null;
  estimatedTotal: string;
  finalTotal: string | null;
  itemStatus: string;
}

export function toOrderItem(i: OrderItem): OrderItemShape {
  return {
    id: i.id,
    productVariantId: i.productVariantId,
    productName: i.productNameSnapshot,
    variantName: i.variantNameSnapshot,
    brandName: i.brandNameSnapshot,
    productCode: i.productCodeSnapshot,
    codeType: i.codeTypeSnapshot,
    unit: i.unitSnapshot,
    productType: i.productTypeSnapshot,
    saleStep: i.saleStepSnapshot,
    unitPrice: decReq(i.unitPrice),
    requestedQuantity: i.requestedQuantity.toString(),
    actualQuantity: i.actualQuantity === null ? null : i.actualQuantity.toString(),
    estimatedTotal: decReq(i.estimatedTotal),
    finalTotal: i.finalTotal === null ? null : i.finalTotal.toString(),
    itemStatus: i.itemStatus,
  };
}

export interface OrderHistoryShape {
  oldStatus: string | null;
  newStatus: string;
  actorType: string;
  createdAt: string;
}

export function toOrderHistory(h: OrderStatusHistory): OrderHistoryShape {
  return {
    oldStatus: h.oldStatus,
    newStatus: h.newStatus,
    actorType: h.actorType,
    createdAt: h.createdAt.toISOString(),
  };
}

export interface OrderShape {
  id: string;
  orderNumber: string;
  status: string;
  idempotencyKey: string | null;
  subtotalEstimated: string;
  discountTotal: string;
  deliveryFee: string;
  totalEstimated: string;
  subtotalFinal: string | null;
  totalFinal: string | null;
  customerName: string;
  customerPhone: string;
  delivery: {
    city: string;
    area: string | null;
    village: string | null;
    street: string | null;
    building: string | null;
    landmark: string | null;
    phone: string;
  };
  items: OrderItemShape[];
  history: OrderHistoryShape[];
  createdAt: string;
  updatedAt: string;
}

type OrderRow = Order & { items: OrderItem[]; history: OrderStatusHistory[] };

export function toOrder(o: OrderRow): OrderShape {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    idempotencyKey: o.idempotencyKey,
    subtotalEstimated: decReq(o.subtotalEstimated),
    discountTotal: decReq(o.discountTotal),
    deliveryFee: decReq(o.deliveryFee),
    totalEstimated: decReq(o.totalEstimated),
    subtotalFinal: o.subtotalFinal === null ? null : o.subtotalFinal.toString(),
    totalFinal: o.totalFinal === null ? null : o.totalFinal.toString(),
    customerName: o.customerNameSnapshot,
    customerPhone: o.customerPhoneSnapshot,
    delivery: {
      city: o.deliveryCity,
      area: o.deliveryArea,
      village: o.deliveryVillage,
      street: o.deliveryStreet,
      building: o.deliveryBuilding,
      landmark: o.deliveryLandmark,
      phone: o.deliveryPhone,
    },
    items: o.items.map(toOrderItem),
    history: o.history.map(toOrderHistory),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toOrderListItem(o: Order, itemCount: number): Omit<OrderShape, "items" | "history"> & { itemCount: number } {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    idempotencyKey: o.idempotencyKey,
    subtotalEstimated: decReq(o.subtotalEstimated),
    discountTotal: decReq(o.discountTotal),
    deliveryFee: decReq(o.deliveryFee),
    totalEstimated: decReq(o.totalEstimated),
    subtotalFinal: o.subtotalFinal === null ? null : o.subtotalFinal.toString(),
    totalFinal: o.totalFinal === null ? null : o.totalFinal.toString(),
    customerName: o.customerNameSnapshot,
    customerPhone: o.customerPhoneSnapshot,
    delivery: {
      city: o.deliveryCity,
      area: o.deliveryArea,
      village: o.deliveryVillage,
      street: o.deliveryStreet,
      building: o.deliveryBuilding,
      landmark: o.deliveryLandmark,
      phone: o.deliveryPhone,
    },
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    itemCount,
  };
}

export { iso };
