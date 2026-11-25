// @vitest-environment node
// ADM-08 — the coupon read inside the order write path uses the TRANSACTION
// connection.
//
// Regression: the order transaction read the coupon row through the global
// client, so it needed a second pooled connection while the transaction was
// open. With the pool saturated, that read waited, the interactive
// transaction's budget expired and a legitimate order failed with an opaque
// 500 instead of a coupon answer. The read also escaped the transaction's
// snapshot, so the row the order decided on was not the row the transaction
// committed against.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
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

const COUPON_PROMO = {
  id: "coupon-promo-1",
  name: "عرض الكوبون",
  type: "PERCENTAGE",
  scope: "LINE",
  priority: 5,
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
  m.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
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

describe("the coupon read in the order write path", () => {
  it("reads the coupon through the transaction client, never the global one", async () => {
    const transaction = tx();
    await applyPromotions(transaction as never, {
      lines: [line("variant-1")],
      customerId: null,
      couponCode: "SAVE50",
      effectivePromos: [COUPON_PROMO] as never,
      categoryTree: new Map(),
    });
    expect(m.findCouponForApply).toHaveBeenCalledTimes(1);
    const [code, client] = m.findCouponForApply.mock.calls[0] as [string, unknown];
    expect(code).toBe("SAVE50");
    expect(client).toBe(transaction);
    // The global client must not be consulted inside the transaction.
    expect(m.prismaQueryRaw).not.toHaveBeenCalled();
  });

  it("the coupon still applies through the shared evaluator", async () => {
    const transaction = tx();
    const result = await applyPromotions(transaction as never, {
      lines: [line("variant-1", 10000)],
      customerId: null,
      couponCode: "SAVE50",
      effectivePromos: [COUPON_PROMO] as never,
      categoryTree: new Map(),
    });
    expect(result.couponApp?.promoId).toBe("coupon-promo-1");
    expect(result.couponApp?.baseC).toBe(10000);
    expect(result.couponApp?.amountC).toBe(5000);
  });
});
