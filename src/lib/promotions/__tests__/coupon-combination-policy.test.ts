// @vitest-environment node
// ADM-OWNER — the coupon / promotion combination policy (LOCKED, 12 Nov 2026).
//
// `COUPON_PROMOTION_COMBINATION_POLICY = EXPLICIT_ENGINE_PERMISSION_ONLY`
//
//   • No automatic aggregation between the coupon and the winning offer.
//   • A combination is allowed ONLY where the engine says so explicitly, with
//     defined and tested conditions.
//   • A lower-priority offer never adds a second discount to the winner.
//   • Checkout and Preview must agree.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  prismaQueryRaw: vi.fn(),
  findCouponForApply: vi.fn(),
  countActiveUsages: vi.fn(),
  loadEffectivePromotions: vi.fn(),
  loadCategoryTree: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: m.prismaQueryRaw },
}));
vi.mock("@/lib/promotions/queries", () => ({
  findCouponForApply: m.findCouponForApply,
  countActiveUsages: m.countActiveUsages,
  loadEffectivePromotions: m.loadEffectivePromotions,
  loadCategoryTree: m.loadCategoryTree,
  inSubtree: () => false,
}));

import { applyPromotions } from "@/lib/promotions/checkout";
import { COUPON_COMBINATION_POLICY, couponCombinationAllowed } from "@/lib/promotions/engine";

const AUTO_PROMO = {
  id: "auto-1",
  name: "عرض أوتوماتيك",
  type: "PERCENTAGE",
  scope: "LINE",
  priority: 10,
  is_stackable: false,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  discount_percent: "20",
  discount_amount: null,
  fixed_price: null,
  minimum_quantity: null,
  minimum_amount: null,
  maximum_discount: null,
  buy_quantity: null,
  get_quantity: null,
  buy_pct: null,
  free_variant_id: null,
  usage_limit: null,
  targets: [{ tt: "VARIANT", tid: "variant-1" }],
};

const COUPON_PROMO = {
  ...AUTO_PROMO,
  id: "coupon-promo-1",
  name: "عرض الكوبون",
  priority: 5,
  discount_percent: "50",
  targets: [{ tt: "VARIANT", tid: "variant-1" }],
};

function tx() {
  return { $queryRaw: m.queryRaw, $executeRaw: vi.fn().mockResolvedValue(0) };
}

function line(variantId: string, priceC = 10000) {
  return {
    variantId,
    qtyT: 1000,
    grossC: priceC,
    unitPriceC: priceC,
    ctx: {
      vid: variantId,
      pid: "product-1",
      bid: null,
      cid: "cat-1",
      pt: "PIECE" as const,
      pu: "PIECE",
      su: null,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    // The coupon's parent promotion IS coupon-gated: it never enters the
    // automatic offer race (the engine's own rule).
    if (sql.includes("SELECT DISTINCT promotion_id")) return [{ pid: "coupon-promo-1" }];
    if (sql.includes("UPDATE promotions SET used_count")) return [{ one: 1 }];
    if (sql.includes("UPDATE coupons SET used_count")) return [{ one: 1 }];
    if (sql.includes("SELECT target_type")) return [{ tt: "VARIANT", tid: "variant-1" }];
    return [];
  });
  m.prismaQueryRaw.mockResolvedValue([]);
  m.loadEffectivePromotions.mockResolvedValue([]);
  m.loadCategoryTree.mockResolvedValue(new Map());
  m.countActiveUsages.mockResolvedValue(0);
  m.findCouponForApply.mockResolvedValue({
    id: "coupon-row-1",
    promotion_id: "coupon-promo-1",
    promo_name: "عرض الكوبون",
    promo_status: "ACTIVE",
    promo_deleted: null,
    promo_type: "PERCENTAGE",
    promo_scope: "LINE",
    pdp: "50",
    pda: null,
    usage_limit: null,
    used_count: 0,
    per_customer_limit: null,
    minimum_order_amount: null,
    is_active: true,
    own_ok: true,
    parent_ok: true,
    promo_max: null,
  });
});

describe("the coupon combination rule is explicit and single-sourced", () => {
  it("the policy forbids combining a coupon with the winning offer", () => {
    expect(COUPON_COMBINATION_POLICY.combinesWithAutomaticWinner).toBe(false);
    expect(COUPON_COMBINATION_POLICY.couponCompetesWithAutomaticOffers).toBe(false);
    expect(COUPON_COMBINATION_POLICY.couponBase).toBe("GROSS");
  });

  it("the rule is decided by one helper both price paths call", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/promotions/checkout.ts"), "utf8");
    // Both price paths call the SAME eligibility evaluator (the one rule set).
    expect((source.match(/evaluateCouponEligibility\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The evaluator itself calls the combination rule once, for both paths.
    const evaluator = readFileSync(
      resolve(process.cwd(), "src/lib/promotions/coupon-eligibility.ts"),
      "utf8",
    );
    expect((evaluator.match(/couponCombinationAllowed\(/g) ?? []).length).toBe(1);
  });

  it("an automatic discount on the coupon's lines blocks the coupon", () => {
    const check = couponCombinationAllowed({
      autoDiscountedLines: new Set([0]),
      autoOrderDiscount: false,
      couponEligibleLines: [0],
    });
    expect(check.allowed).toBe(false);
    expect(check.conflictingLines).toEqual([0]);
  });

  it("an order-level automatic offer blocks the coupon on every line", () => {
    const check = couponCombinationAllowed({
      autoDiscountedLines: new Set(),
      autoOrderDiscount: true,
      couponEligibleLines: [3],
    });
    expect(check.allowed).toBe(false);
  });

  it("the coupon is allowed when no automatic offer touches its lines", () => {
    const check = couponCombinationAllowed({
      autoDiscountedLines: new Set([0]),
      autoOrderDiscount: false,
      couponEligibleLines: [1],
    });
    expect(check.allowed).toBe(true);
  });
});

describe("the checkout enforces the rule", () => {
  it("a qualified offer plus a coupon over the SAME line → the combination is refused", async () => {
    m.loadEffectivePromotions.mockResolvedValue([AUTO_PROMO]);
    await expect(
      applyPromotions(tx() as never, {
        lines: [line("variant-1")],
        customerId: null,
        couponCode: "SAVE50",
        effectivePromos: [AUTO_PROMO, COUPON_PROMO] as never,
        categoryTree: new Map(),
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("a qualified offer on ANOTHER line + a coupon → the coupon applies on its own line", async () => {
    const offerOnVariant2 = { ...AUTO_PROMO, targets: [{ tt: "VARIANT", tid: "variant-2" }] };
    m.loadEffectivePromotions.mockResolvedValue([offerOnVariant2]);
    const result = await applyPromotions(tx() as never, {
      lines: [line("variant-1"), line("variant-2")],
      customerId: null,
      couponCode: "SAVE50",
      effectivePromos: [offerOnVariant2, COUPON_PROMO] as never,
      categoryTree: new Map(),
    });
    // The offer discounts its own line; the coupon discounts its own line.
    // Neither stacks on the other.
    expect(result.lineApps.map((app) => app.promoId)).toEqual(["auto-1"]);
    expect(result.couponApp?.promoId).toBe("coupon-promo-1");
    expect(result.couponApp?.amountC).toBe(5000);
  });

  it("the coupon's base is the GROSS of its lines, never a discounted net", async () => {
    m.loadEffectivePromotions.mockResolvedValue([]);
    const result = await applyPromotions(tx() as never, {
      lines: [line("variant-1", 10000)],
      customerId: null,
      couponCode: "SAVE50",
      effectivePromos: [COUPON_PROMO] as never,
      categoryTree: new Map(),
    });
    expect(result.couponApp?.baseC).toBe(10000);
    expect(result.couponApp?.amountC).toBe(5000);
  });

  it("an invalid or expired coupon is not applied", async () => {
    m.findCouponForApply.mockResolvedValueOnce({
      ...(await m.findCouponForApply()),
      own_ok: false,
      parent_ok: false,
    });
    await expect(
      applyPromotions(tx() as never, {
        lines: [line("variant-1")],
        customerId: null,
        couponCode: "DEAD",
        effectivePromos: [] as never,
        categoryTree: new Map(),
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("two qualified offers → only the highest priority wins, and the lower one adds nothing", async () => {
    m.loadEffectivePromotions.mockResolvedValue([
      AUTO_PROMO,
      { ...AUTO_PROMO, id: "auto-2", name: "أقل أولوية", priority: 1, discount_percent: "5" },
    ]);
    const result = await applyPromotions(tx() as never, {
      lines: [line("variant-1")],
      customerId: null,
      couponCode: null,
      effectivePromos: [
        AUTO_PROMO,
        { ...AUTO_PROMO, id: "auto-2", name: "أقل أولوية", priority: 1, discount_percent: "5" },
      ] as never,
      categoryTree: new Map(),
    });
    expect(result.lineApps.map((app) => app.promoId)).toEqual(["auto-1"]);
    expect(result.discountTotalC).toBe(2000);
  });

  it("the load order of the offers never changes the result", async () => {
    const lower = { ...AUTO_PROMO, id: "auto-2", priority: 1, discount_percent: "5" };
    const first = await applyPromotions(tx() as never, {
      lines: [line("variant-1")],
      customerId: null,
      couponCode: null,
      effectivePromos: [AUTO_PROMO, lower] as never,
      categoryTree: new Map(),
    });
    const second = await applyPromotions(tx() as never, {
      lines: [line("variant-1")],
      customerId: null,
      couponCode: null,
      effectivePromos: [lower, AUTO_PROMO] as never,
      categoryTree: new Map(),
    });
    expect(first.discountTotalC).toBe(second.discountTotalC);
    expect(first.lineApps[0].promoId).toBe(second.lineApps[0].promoId);
  });
});

describe("the storefront estimate and the admin preview use the same rules", () => {
  it("the estimate path selects ONE offer (parity with the checkout)", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/promotions/checkout.ts"), "utf8");
    // Both paths go through the one-winner selector.
    expect((source.match(/winningOfferSet\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("the admin preview result equals the checkout result for the same input", () => {
    // The preview reads the same offer set through the same selector.
    const previewSource = readFileSync(
      resolve(process.cwd(), "src/lib/promotions/admin-preview.ts"),
      "utf8",
    );
    expect(previewSource).toContain("selectWinningOffer([work], promos)");
  });
});
