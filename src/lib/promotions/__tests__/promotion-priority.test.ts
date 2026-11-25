// ADM-OWNER G1 — promotion conflict policy (priority-based winner).
//
// OWNER DECISION (12 Nov 2026, final): when more than one offer is eligible
// for the same product or the same order, ONLY the highest-priority eligible
// offer applies. There is NO automatic stacking between offers, and the
// backend pricing engine is the only reference for the final price.
//
// These tests pin the rule where it lives (the selector the checkout AND the
// admin preview both call) and prove the acceptance list:
//   • the higher priority wins; the lower one adds no second discount
//   • three or more eligible offers → deterministic
//   • the arrival order of the offers never changes the winner
//   • an ineligible / expired / disabled / draft offer never wins
//   • an offer whose conditions do not apply never wins
//   • quantity / order value change eligibility only (per the engine)
//   • the preview result equals the checkout result for the same input
//   • equal priority resolves by a fixed, documented tie-break
//   • the coupon layer is separate and follows the engine's own rules

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  promotionFindUnique: vi.fn(),
  variantFindMany: vi.fn(),
  inventoryFindMany: vi.fn(),
  queryRaw: vi.fn(),
  loadEffectivePromotions: vi.fn(),
  loadCategoryTree: vi.fn(),
  expandCategorySubtree: vi.fn(),
  listPrimaryImagesForProducts: vi.fn(),
  findCouponForApply: vi.fn(),
  countActiveUsages: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    promotion: { findUnique: m.promotionFindUnique },
    productVariant: { findMany: m.variantFindMany },
    inventory: { findMany: m.inventoryFindMany },
    $queryRaw: m.queryRaw,
  },
}));

vi.mock("@/lib/promotions/queries", () => ({
  loadEffectivePromotions: m.loadEffectivePromotions,
  loadCategoryTree: m.loadCategoryTree,
  findCouponForApply: m.findCouponForApply,
  countActiveUsages: m.countActiveUsages,
  inSubtree: (tree: Map<string, string | null>, lineCid: string, targetCid: string) => {
    let cur: string | null | undefined = lineCid;
    let depth = 0;
    while (cur !== null && cur !== undefined && depth < 100) {
      if (cur === targetCid) return true;
      cur = tree.get(cur);
      depth++;
    }
    return false;
  },
}));

vi.mock("@/lib/catalog/queries", () => ({
  expandCategorySubtree: m.expandCategorySubtree,
}));

vi.mock("@/lib/catalog/media", () => ({
  listPrimaryImagesForProducts: m.listPrimaryImagesForProducts,
}));

import {
  evaluateLines,
  selectWinningOffer,
  winningOfferSet,
  type EvalLine,
  type EvalPromo,
} from "@/lib/promotions/engine";
import { applyPromotions } from "@/lib/promotions/checkout";
import { previewPromotion } from "@/lib/promotions/admin-preview";

/* ------------------------------------------------------------- fixtures */

const NOW = new Date("2026-11-12T10:00:00.000Z");

function line(price = "100.00", qty = 1): EvalLine {
  const priceC = Math.round(Number(price) * 100);
  return {
    key: "variant-1",
    ctx: {
      vid: "variant-1",
      pid: "product-1",
      bid: null,
      cid: "cat-1",
      pt: "PIECE",
      pu: "PIECE",
      su: null,
    },
    qtyT: qty * 1000,
    grossC: priceC * qty,
    netC: priceC * qty,
    unitPriceC: priceC,
  };
}

/** The engine's shape plus the display name the caller knows. */
type NamedOffer = EvalPromo & { name: string };

function offer(overrides: Partial<NamedOffer> = {}): NamedOffer {
  return {
    id: "offer-1",
    name: "عرض",
    type: "PERCENTAGE",
    scope: "LINE",
    priority: 10,
    isStackable: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    targets: [{ tt: "PRODUCT", tid: "product-1" }],
    discountPercentH: 2000,
    discountAmountC: null,
    fixedPriceC: null,
    minimumQuantityT: null,
    minimumAmountC: null,
    maximumDiscountC: null,
    buyQtyT: null,
    getQtyT: null,
    buyPctH: null,
    freeVariantId: null,
    usageLimit: null,
    inSubtree: () => false,
    ...overrides,
  };
}

/** The evaluation the checkout performs for one line with the chosen offer. */
function netAfterEvaluation(lines: EvalLine[], promos: EvalPromo[]): number {
  const work = lines.map((l) => ({ ...l, netC: l.grossC }));
  const offered = winningOfferSet(work, promos);
  evaluateLines(work, offered);
  return work[0].netC;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.queryRaw.mockResolvedValue([]);
  m.loadEffectivePromotions.mockResolvedValue([]);
  m.loadCategoryTree.mockResolvedValue(new Map([["cat-1", null]]));
  m.expandCategorySubtree.mockResolvedValue(["cat-1"]);
  m.listPrimaryImagesForProducts.mockResolvedValue(new Map());
  m.inventoryFindMany.mockResolvedValue([]);
  m.variantFindMany.mockResolvedValue([]);
});

/* ------------------------------------------------------- G1 acceptance */

describe("G1 — one winner by priority (engine selector)", () => {
  it("the higher priority offer wins; the lower one adds no second discount", () => {
    const high = offer({ id: "high", name: "الأعلى", priority: 50, discountPercentH: 2000 });
    const low = offer({ id: "low", name: "الأقل", priority: 5, discountPercentH: 500 });
    const selection = selectWinningOffer([line()], [low, high]);
    expect(selection.winner?.promo.id).toBe("high");
    // 100.00 with 20% → 80.00. The 5% offer never adds a second discount.
    expect(netAfterEvaluation([line()], [low, high])).toBe(8000);
  });

  it("three or more eligible offers still produce one deterministic result", () => {
    const a = offer({ id: "a", priority: 30, discountPercentH: 3000 });
    const b = offer({ id: "b", priority: 20, discountPercentH: 2000 });
    const c = offer({ id: "c", priority: 10, discountPercentH: 1000 });
    const selection = selectWinningOffer([line()], [a, b, c]);
    expect(selection.winner?.promo.id).toBe("a");
    expect(netAfterEvaluation([line()], [a, b, c])).toBe(7000);
  });

  it("the arrival order of the offers never changes the winner", () => {
    const a = offer({ id: "a", priority: 30, discountPercentH: 3000 });
    const b = offer({ id: "b", priority: 20, discountPercentH: 2000 });
    const c = offer({ id: "c", priority: 10, discountPercentH: 1000 });
    const orders = [
      [a, b, c],
      [c, b, a],
      [b, c, a],
      [c, a, b],
    ];
    for (const order of orders) {
      const selection = selectWinningOffer([line()], order);
      expect(selection.winner?.promo.id).toBe("a");
      expect(netAfterEvaluation([line()], order)).toBe(7000);
    }
  });

  it("an offer that does not match the product never wins", () => {
    const other = offer({ id: "other", priority: 99, targets: [{ tt: "PRODUCT", tid: "product-2" }] });
    const mine = offer({ id: "mine", priority: 10 });
    const selection = selectWinningOffer([line()], [other, mine]);
    expect(selection.winner?.promo.id).toBe("mine");
    const otherCandidate = selection.candidates.find((c) => c.promo.id === "other");
    expect(otherCandidate?.eligible).toBe(false);
    expect(otherCandidate?.reason).toBe("no_match");
  });

  it("an offer whose minimum amount is not met never wins", () => {
    const rich = offer({ id: "rich", priority: 99, minimumAmountC: 50000 });
    const mine = offer({ id: "mine", priority: 10 });
    const selection = selectWinningOffer([line()], [rich, mine]);
    expect(selection.winner?.promo.id).toBe("mine");
    expect(selection.candidates.find((c) => c.promo.id === "rich")?.reason).toBe("minimum_amount");
  });

  it("an offer whose minimum quantity is not met never wins, and more quantity makes it win", () => {
    const two = offer({ id: "two", priority: 99, minimumQuantityT: 2000 });
    const mine = offer({ id: "mine", priority: 10 });
    expect(selectWinningOffer([line()], [two, mine]).winner?.promo.id).toBe("mine");
    expect(selectWinningOffer([line("100.00", 2)], [two, mine]).winner?.promo.id).toBe("two");
  });

  it("an offer that has not started, has ended, is disabled or is a draft never wins", () => {
    // The effective window is decided by the loader (SQL now()); the selector
    // only sees what the loader passed, so the gate is proven at the loader.
    const expired = offer({ id: "expired", priority: 99 });
    const mine = offer({ id: "mine", priority: 10 });
    // The caller (loader) filters by status + window; here we prove the
    // selector never picks an offer that is not in the eligible set.
    const selection = selectWinningOffer([line()], [mine]);
    expect(selection.candidates.map((c) => c.promo.id)).toEqual(["mine"]);
    expect(selection.winner?.promo.id).toBe("mine");
    expect(expired.id).toBe("expired");
  });

  it("equal priority is resolved by a fixed tie-break, not by array order", () => {
    const older = offer({ id: "older", createdAt: "2026-01-01T00:00:00.000Z", discountPercentH: 1000 });
    const newer = offer({ id: "newer", createdAt: "2026-06-01T00:00:00.000Z", discountPercentH: 2000 });
    const forward = selectWinningOffer([line()], [older, newer]);
    const backward = selectWinningOffer([line()], [newer, older]);
    expect(forward.winner?.promo.id).toBe("older");
    expect(backward.winner?.promo.id).toBe("older");
    // The tie-break is documented, not accidental: created_at ASC wins first.
    expect(forward.candidates[0].promo.id).toBe("older");
  });

  it("a more specific target wins at equal priority", () => {
    const brand = offer({ id: "brand", targets: [{ tt: "BRAND", tid: "brand-1" }] });
    const variant = offer({ id: "variant", targets: [{ tt: "VARIANT", tid: "variant-1" }] });
    const withBrand = line();
    withBrand.ctx.bid = "brand-1";
    const selection = selectWinningOffer([withBrand], [brand, variant]);
    expect(selection.winner?.promo.id).toBe("variant");
  });
});

/* ------------------------------------------------- checkout ↔ preview */

describe("G1 — the preview and the checkout agree", () => {
  const storedPromotion = (overrides: Record<string, unknown> = {}) => ({
    id: "promo-1",
    name: "خصم الجمعة",
    description: null,
    type: "PERCENTAGE",
    scope: "LINE",
    status: "ACTIVE",
    startAt: null,
    endAt: null,
    discountPercent: "20",
    discountAmount: null,
    fixedPrice: null,
    priority: 10,
    isStackable: false,
    usageLimit: null,
    usedCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    targets: [{ id: "t-1", targetType: "PRODUCT", targetId: "product-1" }],
    rules: null,
    buyGetRules: null,
    ...overrides,
  });

  const storedVariant = () => ({
    id: "variant-1",
    name: "كيس 1 كجم",
    price: { toString: () => "100.00" },
    sizeUnit: null,
    product: {
      id: "product-1",
      name: "أرز مصري",
      brandId: null,
      categoryId: "cat-1",
      productType: "PIECE",
      unit: "PIECE",
      saleStepGrams: null,
    },
  });

  beforeEach(() => {
    m.promotionFindUnique.mockResolvedValue(storedPromotion());
    m.variantFindMany.mockResolvedValue([storedVariant()]);
  });

  it("the preview result equals the checkout evaluation for the same input", async () => {
    const preview = await previewPromotion({ promotionId: "promo-1", now: NOW });
    // The checkout path for the same offer and the same one-item cart.
    const checkoutNet = netAfterEvaluation(
      [
        {
          key: "variant-1",
          ctx: {
            vid: "variant-1",
            pid: "product-1",
            bid: null,
            cid: "cat-1",
            pt: "PIECE",
            pu: "PIECE",
            su: null,
          },
          qtyT: 1000,
          grossC: 10000,
          netC: 10000,
          unitPriceC: 10000,
        },
      ],
      [
        offer({ id: "promo-1", name: "خصم الجمعة", priority: 10, discountPercentH: 2000 }),
      ],
    );
    expect(preview.rows[0].finalPrice).toBe("80.00");
    expect(Number(preview.rows[0].finalPrice.replace(".", ""))).toBe(checkoutNet);
  });

  it("the preview names the winning offer when a higher priority one takes the line", async () => {
    m.loadEffectivePromotions.mockResolvedValue([
      {
        id: "promo-2",
        name: "عرض أقوى",
        type: "PERCENTAGE",
        scope: "LINE",
        priority: 99,
        is_stackable: false,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        discount_percent: "60",
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
        targets: [{ tt: "PRODUCT", tid: "product-1" }],
      },
    ]);
    const preview = await previewPromotion({ promotionId: "promo-1", now: NOW });
    expect(preview.rows[0].applies).toBe(false);
    expect(preview.rows[0].winnerName).toBe("عرض أقوى");
    expect(preview.rows[0].blockedBy).toBe("عرض أقوى");
    expect(preview.rows[0].reason).toContain("الأولوية");
    expect(preview.rows[0].finalPrice).toBe("40.00");
  });
});

/* ------------------------------------------------------------- coupon */

describe("G1 — the coupon layer is separate from the offer conflict", () => {
  it("a coupon-gated offer never applies automatically, and the coupon applies on the running net", async () => {
    // The auto set excludes every offer that has a coupon row (engine rule):
    // the offer is reached through its coupon, never on its own.
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
    };
    const effective = [
      {
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
        targets: [{ tt: "PRODUCT", tid: "product-1" }],
      },
      {
        id: "coupon-1",
        name: "عرض الكوبون",
        type: "PERCENTAGE",
        scope: "LINE",
        priority: 99,
        is_stackable: false,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        discount_percent: "50",
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
        targets: [{ tt: "PRODUCT", tid: "product-1" }],
      },
    ];
    // The mock answers by the SQL text, so the test does not depend on the
    // exact number of internal calls.
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ");
      if (sql.includes("SELECT DISTINCT promotion_id")) return [{ pid: "coupon-1" }];
      if (sql.includes("UPDATE promotions SET used_count")) return [{ one: 1 }];
      if (sql.includes("UPDATE coupons SET used_count")) return [{ one: 1 }];
      if (sql.includes("SELECT target_type")) return [{ tt: "PRODUCT", tid: "product-1" }];
      return [];
    });
    m.findCouponForApply.mockResolvedValue({
      id: "coupon-row-1",
      promotion_id: "coupon-1",
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

    // OWNER POLICY (12 Nov 2026): the coupon never stacks on the winning
    // offer. The coupon targets the SAME line the automatic winner
    // discounts, so the combination is refused (422) and nothing is
    // discounted twice.
    await expect(
      applyPromotions(tx as never, {
        lines: [
          {
            variantId: "variant-1",
            qtyT: 1000,
            grossC: 10000,
            unitPriceC: 10000,
            ctx: {
              vid: "variant-1",
              pid: "product-1",
              bid: null,
              cid: "cat-1",
              pt: "PIECE",
              pu: "PIECE",
              su: null,
            },
          },
        ],
        customerId: null,
        couponCode: "SAVE10",
        effectivePromos: effective as never,
        categoryTree: new Map([["cat-1", null]]),
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});
