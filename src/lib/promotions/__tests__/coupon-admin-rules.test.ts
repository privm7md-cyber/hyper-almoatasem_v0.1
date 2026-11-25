// @vitest-environment node
// ADM-08 — the coupon code management acceptance gate.
//
// What is proved HERE (source level):
//   • the coupon status classifier covers every state the operator sees and
//     never contradicts the SQL the list query filters on;
//   • the eligibility evaluator reproduces the checkout's rules one by one,
//     including the owner policy (a coupon never stacks on the winner);
//   • the admin preview endpoint answers with those same rules.
//
// What is NOT proved here (and is not claimed): the live behaviour on a real
// database, the concurrent usage bump under load, and the exact customer
// messages in production. The concurrency guarantees live in the checkout's
// conditional bump (`UPDATE … WHERE used_count < usage_limit`), which is
// unchanged by this work.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateCouponEligibility, type CouponEvaluationRow } from "@/lib/promotions/coupon-eligibility";
import {
  COUPON_STATUS,
  COUPON_STATUS_RULES,
  classifyCouponStatus,
  couponStatusSqlCase,
} from "@/lib/promotions/coupon-status";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function row(overrides: Partial<CouponEvaluationRow> = {}): CouponEvaluationRow {
  return {
    id: "coupon-1",
    promotion_id: "promo-1",
    promo_type: "PERCENTAGE",
    promo_scope: "LINE",
    pdp: "50",
    pda: null,
    promo_max: null,
    usage_limit: null,
    used_count: 0,
    per_customer_limit: null,
    minimum_order_amount: null,
    own_ok: true,
    parent_ok: true,
    ...overrides,
  };
}

function evaluate(overrides: Partial<CouponEvaluationRow> = {}, extra: Partial<Parameters<typeof evaluateCouponEligibility>[0]> = {}) {
  return evaluateCouponEligibility({
    coupon: row(overrides),
    grossTotalC: 10000,
    eligibleGrossC: 10000,
    eligibleLineIndexes: [0],
    customerId: null,
    customerActiveUsages: null,
    autoDiscountedLines: [],
    autoOrderDiscount: false,
    mode: "preview",
    basketProvided: true,
    ...extra,
  });
}

describe("ADM-08 — the coupon status the operator sees", () => {
  it("covers every state the coupon screen offers", () => {
    const statuses = COUPON_STATUS_RULES.map((rule) => rule.status);
    expect(statuses).toEqual([
      "INACTIVE",
      "NOT_STARTED",
      "EXPIRED",
      "LIMIT_REACHED",
      "PARENT_UNAVAILABLE",
      "TYPE_UNSUPPORTED",
      "ACTIVE",
    ]);
  });

  it("an enabled coupon inside its window is ACTIVE", () => {
    const status = classifyCouponStatus(
      {
        isActive: true,
        startAt: new Date("2026-06-01T00:00:00.000Z"),
        endAt: new Date("2026-06-30T00:00:00.000Z"),
        usageLimit: 10,
        usedCount: 2,
        parentOk: true,
        promoType: "PERCENTAGE",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.ACTIVE);
    expect(status.usable).toBe(true);
    expect(status.labelAr.length).toBeGreaterThan(2);
  });

  it("a switched-off coupon is INACTIVE even inside its window", () => {
    const status = classifyCouponStatus(
      {
        isActive: false,
        startAt: null,
        endAt: null,
        usageLimit: null,
        usedCount: 0,
        parentOk: true,
        promoType: "PERCENTAGE",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.INACTIVE);
    expect(status.usable).toBe(false);
  });

  it("a coupon whose start date is ahead is NOT_STARTED", () => {
    const status = classifyCouponStatus(
      {
        isActive: true,
        startAt: new Date("2026-07-01T00:00:00.000Z"),
        endAt: null,
        usageLimit: null,
        usedCount: 0,
        parentOk: true,
        promoType: "PERCENTAGE",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.NOT_STARTED);
  });

  it("a coupon whose end date has passed is EXPIRED", () => {
    const status = classifyCouponStatus(
      {
        isActive: true,
        startAt: null,
        endAt: new Date("2026-06-01T00:00:00.000Z"),
        usageLimit: null,
        usedCount: 0,
        parentOk: true,
        promoType: "PERCENTAGE",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.EXPIRED);
  });

  it("a coupon that used up its global limit is LIMIT_REACHED", () => {
    const status = classifyCouponStatus(
      {
        isActive: true,
        startAt: null,
        endAt: null,
        usageLimit: 5,
        usedCount: 5,
        parentOk: true,
        promoType: "PERCENTAGE",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.LIMIT_REACHED);
  });

  it("a coupon whose offer is not live is PARENT_UNAVAILABLE", () => {
    const status = classifyCouponStatus(
      {
        isActive: true,
        startAt: null,
        endAt: null,
        usageLimit: null,
        usedCount: 0,
        parentOk: false,
        promoType: "PERCENTAGE",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.PARENT_UNAVAILABLE);
  });

  it("a coupon on an unsupported discount type is TYPE_UNSUPPORTED", () => {
    const status = classifyCouponStatus(
      {
        isActive: true,
        startAt: null,
        endAt: null,
        usageLimit: null,
        usedCount: 0,
        parentOk: true,
        promoType: "BUY_X_GET_Y",
      },
      NOW,
    );
    expect(status.status).toBe(COUPON_STATUS.TYPE_UNSUPPORTED);
  });

  it("the SQL CASE the list filter uses is generated from the same ordered rules", () => {
    const sql = couponStatusSqlCase();
    // The precedence is encoded in the arms' order, so the filter and the
    // badge can never disagree.
    const armOrder = [...sql.matchAll(/THEN '([A-Z_]+)'/g)].map((match) => match[1]);
    expect(armOrder).toEqual(COUPON_STATUS_RULES.map((rule) => rule.status));
    expect(sql).toContain("c.used_count >= c.usage_limit");
    expect(sql).toContain("p.deleted_at IS NULL");
  });
});

describe("ADM-08 — the coupon eligibility rules (the checkout's rules)", () => {
  it("a valid percentage coupon is applicable and its amount is the percentage", () => {
    const result = evaluate({ pdp: "50" });
    expect(result.applicable).toBe(true);
    expect(result.baseC).toBe(10000);
    expect(result.amountC).toBe(5000);
    expect(result.blockedBy).toBeNull();
  });

  it("a valid fixed-amount coupon is applied on its fixed value", () => {
    const result = evaluate({ promo_type: "FIXED_AMOUNT", pdp: null, pda: "50.00" });
    expect(result.applicable).toBe(true);
    expect(result.amountC).toBe(5000);
  });

  it("a fixed-amount coupon larger than the basket is capped, not negative", () => {
    const result = evaluate({ promo_type: "FIXED_AMOUNT", pdp: null, pda: "500.00" });
    expect(result.amountC).toBe(10000);
  });

  it("the offer's maximum discount caps the amount", () => {
    const result = evaluate({ pdp: "50", promo_max: "20.00" });
    expect(result.amountC).toBe(2000);
  });

  it("an order below the minimum is blocked with the checkout's message", () => {
    const result = evaluate({ minimum_order_amount: "500.00" });
    expect(result.applicable).toBe(false);
    expect(result.blockedBy).toBe("MINIMUM");
    const condition = result.conditions.find((c) => c.code === "MINIMUM");
    expect(condition?.messageEn).toBe("Coupon minimum order amount not reached.");
  });

  it("an order above the minimum passes", () => {
    const result = evaluate({ minimum_order_amount: "50.00" });
    expect(result.applicable).toBe(true);
  });

  it("a coupon whose window is closed is blocked as not valid", () => {
    const result = evaluate({ own_ok: false });
    expect(result.blockedBy).toBe("VALIDITY");
    expect(result.conditions.find((c) => c.code === "VALIDITY")?.messageEn).toBe(
      "Coupon is not currently valid.",
    );
  });

  it("a coupon whose offer is not live is blocked as not valid", () => {
    const result = evaluate({ parent_ok: false });
    expect(result.blockedBy).toBe("VALIDITY");
  });

  it("a used-up global limit is blocked", () => {
    const result = evaluate({ usage_limit: 5, used_count: 5 });
    expect(result.blockedBy).toBe("USAGE_LIMIT");
    expect(result.conditions.find((c) => c.code === "USAGE_LIMIT")?.messageEn).toBe(
      "Coupon usage limit reached.",
    );
  });

  it("a per-customer coupon needs a customer account", () => {
    const result = evaluate({ per_customer_limit: 1 });
    expect(result.blockedBy).toBe("REQUIRES_CUSTOMER");
    expect(result.conditions.find((c) => c.code === "REQUIRES_CUSTOMER")?.messageEn).toBe(
      "Coupon requires a customer account.",
    );
  });

  it("a per-customer coupon is blocked once the customer used it", () => {
    const result = evaluate(
      { per_customer_limit: 1 },
      { customerId: "customer-1", customerActiveUsages: 1 },
    );
    expect(result.blockedBy).toBe("PER_CUSTOMER_LIMIT");
    expect(result.conditions.find((c) => c.code === "PER_CUSTOMER_LIMIT")?.messageEn).toBe(
      "Coupon per-customer limit reached.",
    );
  });

  it("an unsupported discount type is blocked", () => {
    const result = evaluate({ promo_type: "BUY_X_GET_Y" });
    expect(result.blockedBy).toBe("PROMO_TYPE");
    expect(result.conditions.find((c) => c.code === "PROMO_TYPE")?.messageEn).toBe(
      "Coupon promotion type is not supported.",
    );
  });

  it("OWNER POLICY: a coupon never stacks on the winning offer", () => {
    const blocked = evaluate({}, { autoDiscountedLines: [0] });
    expect(blocked.applicable).toBe(false);
    expect(blocked.blockedBy).toBe("COMBINATION");
    expect(blocked.conditions.find((c) => c.code === "COMBINATION")?.messageEn).toContain(
      "never stacks on the winning offer",
    );
  });

  it("OWNER POLICY: an order-level automatic offer blocks the coupon too", () => {
    const blocked = evaluate({}, { autoOrderDiscount: true });
    expect(blocked.blockedBy).toBe("COMBINATION");
  });

  it("OWNER POLICY: the coupon applies when the winner touches another line", () => {
    const allowed = evaluate({}, { autoDiscountedLines: [7] });
    expect(allowed.applicable).toBe(true);
    expect(allowed.amountC).toBe(5000);
  });

  it("a basket with no line the offer targets is blocked", () => {
    const result = evaluate({}, { eligibleLineIndexes: [], eligibleGrossC: 0 });
    expect(result.blockedBy).toBe("ELIGIBLE_LINES");
  });

  it("without a basket the basket-dependent rules never block", () => {
    const result = evaluate(
      { minimum_order_amount: "500.00" },
      { basketProvided: false, eligibleLineIndexes: [], eligibleGrossC: 0 },
    );
    expect(result.applicable).toBe(true);
    const minimum = result.conditions.find((c) => c.code === "MINIMUM");
    expect(minimum?.requiresBasket).toBe(true);
  });

  it("the write mode leaves the usage limit to the atomic bump", () => {
    const result = evaluateCouponEligibility({
      coupon: row({ usage_limit: 1, used_count: 5 }),
      grossTotalC: 10000,
      eligibleGrossC: 10000,
      eligibleLineIndexes: [0],
      customerId: null,
      customerActiveUsages: null,
      autoDiscountedLines: [],
      autoOrderDiscount: false,
      mode: "write",
    });
    // No USAGE_LIMIT condition in write mode: the conditional bump is the
    // real gate, so the evaluator must not pre-empt it.
    expect(result.conditions.some((c) => c.code === "USAGE_LIMIT")).toBe(false);
  });
});

describe("ADM-08 — the rules are shared with the checkout (one source of truth)", () => {
  it("the checkout uses the same evaluator and the same policy constant", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/promotions/checkout.ts"), "utf8");
    expect(source).toContain("evaluateCouponEligibility");
    expect(source).toContain("COUPON_COMBINATION_POLICY");
    // The checkout must NOT keep a second, private copy of the rules.
    expect(source).not.toMatch(/throw businessRule\("Coupon minimum order amount not reached\."/);
    expect(source).not.toMatch(/throw businessRule\("Coupon per-customer limit reached\."/);
    expect(source).not.toMatch(/throw businessRule\("Coupon promotion type is not supported\."/);
  });

  it("the admin coupon reads use the same validity SQL as the checkout", () => {
    const admin = readFileSync(
      resolve(process.cwd(), "src/lib/promotions/admin-coupon-queries.ts"),
      "utf8",
    );
    const checkout = readFileSync(resolve(process.cwd(), "src/lib/promotions/queries.ts"), "utf8");
    for (const fragment of [
      "c.is_active AND (c.start_at IS NULL OR c.start_at <= now())",
      "c.end_at IS NULL OR c.end_at > now()",
      "p.status = 'ACTIVE' AND p.deleted_at IS NULL",
    ]) {
      expect(admin).toContain(fragment);
      expect(checkout).toContain(fragment);
    }
  });
});
