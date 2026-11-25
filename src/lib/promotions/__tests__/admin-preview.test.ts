// ADM-07 admin price preview — isolated (no database, no network).
//
// The point of these tests is that the preview is NOT a second pricing
// engine: it feeds the checkout engine the same offer shape and reads the
// engine's numbers back. The database is mocked; the engine is real.

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

import { previewPromotion } from "@/lib/promotions/admin-preview";

const NOW = new Date("2026-11-12T10:00:00.000Z");

function promoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "promo-1",
    name: "خصم الجمعة",
    type: "PERCENTAGE",
    scope: "LINE",
    status: "ACTIVE",
    priority: 10,
    isStackable: false,
    usageLimit: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    discountPercent: { toString: () => "20" },
    discountAmount: null,
    fixedPrice: null,
    targets: [{ targetType: "PRODUCT", targetId: "product-1" }],
    rules: null,
    buyGetRules: null,
    ...overrides,
  };
}

function variantRow(price: string, extra: Record<string, unknown> = {}) {
  return {
    id: "variant-1",
    name: "كيس 1 كجم",
    price: { toString: () => price },
    sizeUnit: "KG",
    product: {
      id: "product-1",
      name: "أرز مصري",
      brandId: null,
      categoryId: "cat-1",
      productType: "WEIGHT",
      unit: "KG",
      saleStepGrams: 1000,
    },
    ...extra,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.promotionFindUnique.mockResolvedValue(promoRow());
  m.variantFindMany.mockResolvedValue([variantRow("100.00")]);
  m.inventoryFindMany.mockResolvedValue([
    { productVariantId: "variant-1", availableQuantity: { toString: () => "12.000" } },
  ]);
  m.queryRaw.mockResolvedValue([]);
  m.loadEffectivePromotions.mockResolvedValue([]);
  m.loadCategoryTree.mockResolvedValue(new Map([["cat-1", null]]));
  m.expandCategorySubtree.mockResolvedValue(["cat-1"]);
  m.listPrimaryImagesForProducts.mockResolvedValue(
    new Map([["product-1", { url: "https://cdn.test/rice.png", altText: null }]]),
  );
});

describe("ADM-07 admin price preview", () => {
  it("computes old price, discount, new price and saving from the checkout engine", async () => {
    const result = await previewPromotion({ promotionId: "promo-1", now: NOW });
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.originalPrice).toBe("100.00");
    expect(row.discountAmount).toBe("20.00");
    expect(row.finalPrice).toBe("80.00");
    expect(row.savingsPercent).toBe("20.00");
    expect(row.applies).toBe(true);
    expect(row.productName).toBe("أرز مصري");
    expect(row.imageUrl).toBe("https://cdn.test/rice.png");
  });

  it("never touches the stored price and never writes anything", async () => {
    await previewPromotion({ promotionId: "promo-1", now: NOW });
    // The offer is READ with a `where` only — there is no `data` payload, so
    // the preview cannot write the offer, its price or anything else.
    const args = m.promotionFindUnique.mock.calls[0][0] as Record<string, unknown>;
    expect(args.where).toEqual({ id: "promo-1" });
    expect(args).not.toHaveProperty("data");
    expect(m.inventoryFindMany).toHaveBeenCalled();
    expect(m.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("quotes a value the operator is trying, without saving it", async () => {
    const result = await previewPromotion({
      promotionId: "promo-1",
      override: { discountPercent: "50" },
      now: NOW,
    });
    expect(result.rows[0].finalPrice).toBe("50.00");
    expect(result.rows[0].discountAmount).toBe("50.00");
  });

  it("says so when a higher priority live offer wins the line", async () => {
    m.loadEffectivePromotions.mockResolvedValue([
      {
        id: "promo-2",
        name: "خصم أقوى",
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
    const result = await previewPromotion({ promotionId: "promo-1", now: NOW });
    expect(result.rows[0].blockedBy).toBe("خصم أقوى");
    expect(result.rows[0].applies).toBe(false);
    expect(result.rows[0].finalPrice).toBe("40.00");
    expect(result.rows[0].reason).toContain("خصم أقوى");
  });

  it("reports a missing balance as unknown, never as zero", async () => {
    m.inventoryFindMany.mockResolvedValue([]);
    const result = await previewPromotion({ promotionId: "promo-1", now: NOW });
    expect(result.rows[0].availableQuantity).toBeNull();
  });

  it("reports a confirmed zero balance as zero", async () => {
    m.inventoryFindMany.mockResolvedValue([
      { productVariantId: "variant-1", availableQuantity: { toString: () => "0.000" } },
    ]);
    const result = await previewPromotion({ promotionId: "promo-1", now: NOW });
    expect(result.rows[0].availableQuantity).toBe("0.000");
  });

  it("returns an empty result for an offer that does not exist", async () => {
    m.promotionFindUnique.mockResolvedValue(null);
    const result = await previewPromotion({ promotionId: "missing", now: NOW });
    expect(result.rows).toEqual([]);
    expect(result.empty).toBe(true);
  });

  it("returns an empty result when the offer has no targets", async () => {
    m.promotionFindUnique.mockResolvedValue(promoRow({ targets: [] }));
    const result = await previewPromotion({ promotionId: "promo-1", now: NOW });
    expect(result.rows).toEqual([]);
    // Nothing is queried when there is nothing to target.
    expect(m.variantFindMany).not.toHaveBeenCalled();
  });
});
