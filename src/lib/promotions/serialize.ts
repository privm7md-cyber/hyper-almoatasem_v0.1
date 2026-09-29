// BA-8 promotion/coupon serialization (boundary shapes).
//
// Decimals as exact strings (Prisma Decimal toString — numerically exact).
// Timestamps as ISO strings (nullable preserved). No secrets exist on
// these tables; counters are operational facts, serialized as numbers.
import type {
  Coupon,
  CouponUsage,
  OrderDiscount,
  Prisma,
  Promotion,
  PromotionBuyGetRule,
  PromotionRule,
  PromotionTarget,
} from "@prisma/client";

const dec = (v: Prisma.Decimal | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toString();
const decReq = (v: Prisma.Decimal): string => v.toString();
const iso = (v: Date | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toISOString();

export interface TargetShape {
  id: string;
  targetType: string;
  targetId: string;
}

export function toTarget(t: PromotionTarget): TargetShape {
  return { id: t.id, targetType: t.targetType, targetId: t.targetId };
}

export interface RulesShape {
  minimumQuantity: string | null;
  minimumAmount: string | null;
  maximumDiscount: string | null;
}

export function toRules(r: PromotionRule | null): RulesShape | null {
  if (!r) return null;
  return {
    minimumQuantity: dec(r.minimumQuantity),
    minimumAmount: dec(r.minimumAmount),
    maximumDiscount: dec(r.maximumDiscount),
  };
}

export interface BuyGetShape {
  buyQuantity: string;
  getQuantity: string;
  discountPercent: string;
  freeVariantId: string | null;
}

export function toBuyGet(r: PromotionBuyGetRule | null): BuyGetShape | null {
  if (!r) return null;
  return {
    buyQuantity: decReq(r.buyQuantity),
    getQuantity: decReq(r.getQuantity),
    discountPercent: decReq(r.discountPercent),
    freeVariantId: r.freeVariantId,
  };
}

export interface PromotionShape {
  id: string;
  name: string;
  description: string | null;
  type: string;
  scope: string;
  status: string;
  startAt: string | null;
  endAt: string | null;
  discountPercent: string | null;
  discountAmount: string | null;
  fixedPrice: string | null;
  priority: number;
  isStackable: boolean;
  usageLimit: number | null;
  usedCount: number;
  createdAt: string;
  updatedAt: string;
  targets: TargetShape[];
  rules: RulesShape | null;
  buyGet: BuyGetShape | null;
}

type PromotionGraph = Promotion & {
  targets: PromotionTarget[];
  rules: PromotionRule | null;
  buyGetRules: PromotionBuyGetRule | null;
};

export function toPromotion(p: PromotionGraph): PromotionShape {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    type: p.type,
    scope: p.scope,
    status: p.status,
    startAt: iso(p.startAt),
    endAt: iso(p.endAt),
    discountPercent: dec(p.discountPercent),
    discountAmount: dec(p.discountAmount),
    fixedPrice: dec(p.fixedPrice),
    priority: p.priority,
    isStackable: p.isStackable,
    usageLimit: p.usageLimit,
    usedCount: p.usedCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    targets: p.targets.map(toTarget),
    rules: toRules(p.rules),
    buyGet: toBuyGet(p.buyGetRules),
  };
}

export interface CouponShape {
  id: string;
  promotionId: string;
  code: string;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  minimumOrderAmount: string | null;
  startAt: string | null;
  endAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toCoupon(c: Coupon): CouponShape {
  return {
    id: c.id,
    promotionId: c.promotionId,
    code: c.code,
    usageLimit: c.usageLimit,
    usedCount: c.usedCount,
    perCustomerLimit: c.perCustomerLimit,
    minimumOrderAmount: dec(c.minimumOrderAmount),
    startAt: iso(c.startAt),
    endAt: iso(c.endAt),
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export interface UsageShape {
  id: string;
  couponId: string;
  customerId: string;
  orderId: string;
  estimatedDiscount: string;
  finalDiscount: string | null;
  createdAt: string;
}

export function toUsage(u: CouponUsage): UsageShape {
  return {
    id: u.id,
    couponId: u.couponId,
    customerId: u.customerId,
    orderId: u.orderId,
    estimatedDiscount: decReq(u.estimatedDiscountAmount),
    finalDiscount: dec(u.finalDiscountAmount),
    createdAt: u.createdAt.toISOString(),
  };
}

export interface OrderDiscountShape {
  id: string;
  orderItemId: string | null;
  promotionId: string;
  couponId: string | null;
  kind: string;
  promotionName: string;
  type: string;
  scope: string;
  appliedPercent: string | null;
  appliedAmount: string | null;
  appliedFixedPrice: string | null;
  capAmount: string | null;
  baseEstimated: string;
  discountEstimated: string;
  parentDiscountId: string | null;
}

export function toOrderDiscount(d: OrderDiscount): OrderDiscountShape {
  return {
    id: d.id,
    orderItemId: d.orderItemId,
    promotionId: d.promotionId,
    couponId: d.couponId,
    kind: d.kind,
    promotionName: d.promotionNameSnapshot,
    type: d.typeSnapshot,
    scope: d.scopeSnapshot,
    appliedPercent: dec(d.appliedPercent),
    appliedAmount: dec(d.appliedAmount),
    appliedFixedPrice: dec(d.appliedFixedPrice),
    capAmount: dec(d.capAmount),
    baseEstimated: decReq(d.baseEstimated),
    discountEstimated: decReq(d.discountEstimated),
    parentDiscountId: d.parentDiscountId,
  };
}
