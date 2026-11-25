// BA-8 promotion/coupon serialization (boundary shapes).
//
// Decimals as exact strings (Prisma Decimal toString — numerically exact).
// Timestamps as ISO strings (nullable preserved). No secrets exist on
// these tables; counters are operational facts, serialized as numbers.
import type {
  Coupon,
  CouponUsage,
  OrderDiscount,
  Promotion,
  PromotionBuyGetRule,
  PromotionRule,
  PromotionTarget,
} from "@prisma/client";
import { dec, decReq, iso } from "@/lib/api/serialize";
import { couponStatusLabel, type CouponStatusValue } from "@/lib/promotions/coupon-status";
import type { AdminCouponRow } from "@/lib/promotions/admin-coupon-queries";

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

/** The admin view of a coupon: the real status and the real usage money. */
export interface AdminCouponShape extends CouponShape {
  /** The computed status (never just the `is_active` flag). */
  status: CouponStatusValue;
  statusLabel: string;
  /** The offer the code rides on. */
  offer: {
    id: string;
    name: string;
    type: string;
    scope: string;
    status: string;
    percent: string | null;
    amount: string | null;
    maximumDiscount: string | null;
  };
  /** The usage facts (counted from `coupon_usages`, not from a counter). */
  usage: {
    rows: number;
    totalDiscount: string;
    distinctCustomers: number;
    lastUsedAt: string | null;
  };
}

export function toAdminCoupon(row: AdminCouponRow): AdminCouponShape {
  return {
    id: row.id,
    promotionId: row.promotion_id,
    code: row.code,
    usageLimit: row.usage_limit,
    usedCount: row.used_count,
    perCustomerLimit: row.per_customer_limit,
    minimumOrderAmount: row.minimum_order_amount,
    startAt: row.start_at ? row.start_at.toISOString() : null,
    endAt: row.end_at ? row.end_at.toISOString() : null,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    status: row.status,
    statusLabel: couponStatusLabel(row.status),
    offer: {
      id: row.promotion_id,
      name: row.promo_name,
      type: row.promo_type,
      scope: row.promo_scope,
      status: row.promo_status,
      percent: row.pdp,
      amount: row.pda,
      maximumDiscount: row.promo_max,
    },
    usage: {
      rows: row.usage_rows,
      totalDiscount: row.total_discount,
      distinctCustomers: row.distinct_customers,
      lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    },
  };
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
  /** NULL for guest-order usage rows (BG-Guest-Order). */
  customerId: string | null;
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
