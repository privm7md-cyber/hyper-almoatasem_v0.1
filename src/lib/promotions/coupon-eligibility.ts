// ============================================================================
// COUPON ELIGIBILITY — the ONE rule set for "may this coupon be applied?"
// ============================================================================
// The checkout (`applyCoupon`) and the admin coupon preview MUST agree on what
// "this coupon works" means. Two implementations of the same rule drift, so
// there is exactly ONE: this pure evaluator.
//
// It is pure on purpose: no DB, no clock of its own (the caller passes
// `now`), no writes. The write path passes `mode: "write"` (the atomic usage
// bump stays the real gate for the usage limit) and the read-only preview
// passes `mode: "preview"` (the limit is evaluated from the stored counters).
//
// The condition ORDER below is the write path's order: the first failing
// condition is the one the customer is told about. Do not reorder it without
// re-pinning the checkout tests.
//
// The `messageEn` strings are the EXACT messages the checkout throws. The
// `messageAr` strings are the admin-facing explanation of the same rule.
// ============================================================================
import { couponCombinationAllowed, divRoundHalfAway, parseScaled } from "@/lib/promotions/engine";

export type CouponConditionCode =
  | "CODE_FORMAT"
  | "EXISTS"
  | "VALIDITY"
  | "MINIMUM"
  | "USAGE_LIMIT"
  | "REQUIRES_CUSTOMER"
  | "PER_CUSTOMER_LIMIT"
  | "PROMO_TYPE"
  | "COMBINATION"
  | "ELIGIBLE_LINES"
  | "NO_DISCOUNT";

export interface CouponCondition {
  code: CouponConditionCode;
  /** True when this rule is met for the evaluated basket. */
  satisfied: boolean;
  /**
   * True when the rule can only be decided with a real basket (the admin
   * preview was asked without one). Such a condition never blocks.
   */
  requiresBasket?: boolean;
  /** The exact customer-facing message the checkout uses for this rule. */
  messageEn: string;
  /** The admin-facing Arabic explanation of the same rule. */
  messageAr: string;
}

export interface CouponEvaluationRow {
  id: string;
  promotion_id: string;
  promo_type: string;
  promo_scope: string;
  /** The offer's percentage, scaled by 100 (as text). */
  pdp: string | null;
  /** The offer's fixed amount, scaled by 100 (as text). */
  pda: string | null;
  /** The offer's maximum discount, scaled by 100 (as text). */
  promo_max: string | null;
  usage_limit: number | null;
  used_count: number;
  per_customer_limit: number | null;
  /** The coupon's minimum order amount, scaled by 100 (as text). */
  minimum_order_amount: string | null;
  /** The SQL-computed coupon window/flag validity. */
  own_ok: boolean;
  /** The SQL-computed parent-offer validity. */
  parent_ok: boolean;
}

export interface CouponEvaluationInput {
  /** The resolved coupon row, or null when the code is unknown. */
  coupon: CouponEvaluationRow | null;
  /** The basket's total gross (all lines), in cents. */
  grossTotalC: number;
  /** The gross of the lines the coupon's offer targets, in cents. */
  eligibleGrossC: number;
  /** The line indexes the coupon's offer targets (the real ones). */
  eligibleLineIndexes: readonly number[];
  /** The signed-in customer, or null for a guest. */
  customerId: string | null;
  /** The customer's active (non-cancelled) usage count; null = not evaluated. */
  customerActiveUsages: number | null;
  /** The line indexes an automatic offer already discounted. */
  autoDiscountedLines: readonly number[] | ReadonlySet<number>;
  /** True when an order-level automatic offer applies. */
  autoOrderDiscount: boolean;
  /** `write` = the atomic bump is the real usage gate; `preview` = read-only. */
  mode: "write" | "preview";
  /**
   * False when no basket was supplied (the admin preview without a sample
   * basket). The basket-dependent rules are then reported as "needs a
   * basket" and never block.
   */
  basketProvided?: boolean;
}

export interface CouponEvaluation {
  /** True when every evaluated condition is satisfied. */
  applicable: boolean;
  /** Every condition, in the write path's order. */
  conditions: CouponCondition[];
  /** The first failing condition (null when applicable). */
  blockedBy: CouponConditionCode | null;
  /** The discount the coupon would grant, in cents (null when not applicable). */
  amountC: number | null;
  /** The base the discount is computed on, in cents (null when not applicable). */
  baseC: number | null;
  /** The lines where an automatic offer already applies (the policy conflict). */
  conflictingLines: number[];
}

const MESSAGES: Record<CouponConditionCode, { en: string; ar: string }> = {
  CODE_FORMAT: {
    en: "Invalid coupon code.",
    ar: "شكل الكود غير صحيح.",
  },
  EXISTS: {
    en: "Coupon not found.",
    ar: "مفيش كود الخصم ده.",
  },
  VALIDITY: {
    en: "Coupon is not currently valid.",
    ar: "الكود مش شغّال دلوقتي (موقوف أو خارج تاريخه أو العرض اللي وراه مش شغّال).",
  },
  MINIMUM: {
    en: "Coupon minimum order amount not reached.",
    ar: "قيمة الطلب أقل من الحد الأدنى المطلوب للكود.",
  },
  USAGE_LIMIT: {
    en: "Coupon usage limit reached.",
    ar: "الكود وصل الحد الأقصى للاستخدام.",
  },
  REQUIRES_CUSTOMER: {
    en: "Coupon requires a customer account.",
    ar: "الكود ده محتاج حساب عميل — الطلبات كضيف مش بتقبله.",
  },
  PER_CUSTOMER_LIMIT: {
    en: "Coupon per-customer limit reached.",
    ar: "العميل ده استعمل الكود الحد المسموح له.",
  },
  PROMO_TYPE: {
    en: "Coupon promotion type is not supported.",
    ar: "نوع العرض اللي ورا الكود غير مدعوم للأكواد.",
  },
  COMBINATION: {
    en: "Coupon cannot be combined with the running offer: a coupon never stacks on the winning offer.",
    ar: "فيه عرض شغّال على نفس المنتجات — الكود ما بيتجمعش مع العرض الفائز.",
  },
  ELIGIBLE_LINES: {
    ar: "مفيش منتجات في الطلب على العرض اللي ورا الكود.",
    en: "Coupon has no eligible lines.",
  },
  NO_DISCOUNT: {
    en: "Coupon grants no discount.",
    ar: "الكود مش هيدي خصم على الطلب ده.",
  },
};

function condition(code: CouponConditionCode, satisfied: boolean): CouponCondition {
  return {
    code,
    satisfied,
    messageEn: MESSAGES[code].en,
    messageAr: MESSAGES[code].ar,
  };
}

/** The percentage/amount scales: the DB stores money as text scaled by 100. */
function scaled(text: string | null): number {
  if (text === null) return 0;
  return parseScaled(text, 2);
}

/**
 * Evaluate every coupon rule for one basket. Pure — the caller supplies the
 * row, the basket and the clock-free counters.
 */
export function evaluateCouponEligibility(input: CouponEvaluationInput): CouponEvaluation {
  const conditions: CouponCondition[] = [];
  const cp = input.coupon;

  if (!cp) {
    conditions.push(condition("EXISTS", false));
    return {
      applicable: false,
      conditions,
      blockedBy: "EXISTS",
      amountC: null,
      baseC: null,
      conflictingLines: [],
    };
  }

  // 1) The code exists and its window/flag are valid, and the parent offer is
  //    live (the SQL-computed flags — the same ones the checkout reads).
  conditions.push(condition("VALIDITY", cp.own_ok && cp.parent_ok));

  // 2) The minimum order amount.
  const minimumC = scaled(cp.minimum_order_amount);
  const basketProvided = input.basketProvided !== false;
  conditions.push({
    ...condition("MINIMUM", cp.minimum_order_amount === null || input.grossTotalC >= minimumC),
    ...(basketProvided ? {} : { requiresBasket: true }),
  });

  // 3) The global usage limit. In write mode the atomic conditional bump is
  //    the real gate (it cannot be read), so the condition is reported as met
  //    and the bump decides. In preview mode the stored counters answer it.
  if (input.mode === "preview") {
    conditions.push(
      condition("USAGE_LIMIT", cp.usage_limit === null || cp.used_count < cp.usage_limit),
    );
  }

  // 4) The per-customer limit (guests cannot satisfy it).
  if (cp.per_customer_limit !== null) {
    if (input.customerId === null) {
      conditions.push(condition("REQUIRES_CUSTOMER", false));
    } else {
      const used = input.customerActiveUsages ?? 0;
      conditions.push(condition("PER_CUSTOMER_LIMIT", used < cp.per_customer_limit));
    }
  }

  // 5) The offer's discount type must be one the coupon layer supports.
  conditions.push(
    condition(
      "PROMO_TYPE",
      cp.promo_type === "PERCENTAGE" || cp.promo_type === "FIXED_AMOUNT",
    ),
  );

  // 6) The owner policy: a coupon never stacks on the winning offer.
  const combination = couponCombinationAllowed({
    autoDiscountedLines: new Set(input.autoDiscountedLines),
    autoOrderDiscount: input.autoOrderDiscount,
    couponEligibleLines: input.eligibleLineIndexes,
  });  conditions.push({
    ...condition("COMBINATION", combination.allowed),
    ...(basketProvided ? {} : { requiresBasket: true }),
  });

  // 7) There must be lines the offer targets, and they must carry a gross.
  conditions.push({
    ...condition("ELIGIBLE_LINES", input.eligibleLineIndexes.length > 0 && input.eligibleGrossC > 0),
    ...(basketProvided ? {} : { requiresBasket: true }),
  });

  // 8) The computed discount must be positive.
  const baseC = input.eligibleGrossC;
  let amountC = 0;
  if (cp.promo_type === "PERCENTAGE") {
    amountC = divRoundHalfAway(baseC * scaled(cp.pdp), 10000);
  } else if (cp.promo_type === "FIXED_AMOUNT") {
    amountC = Math.min(scaled(cp.pda), baseC);
  }
  const capC = cp.promo_max === null ? null : scaled(cp.promo_max);
  if (capC !== null) amountC = Math.min(amountC, capC);
  conditions.push({
    ...condition("NO_DISCOUNT", amountC > 0 && baseC > 0),
    ...(basketProvided ? {} : { requiresBasket: true }),
  });

  const blockedBy = conditions.find((c) => !c.satisfied && !c.requiresBasket)?.code ?? null;
  return {
    applicable: blockedBy === null,
    conditions,
    blockedBy,
    amountC: blockedBy === null ? amountC : null,
    baseC: blockedBy === null ? baseC : null,
    conflictingLines: combination.conflictingLines,
  };
}
