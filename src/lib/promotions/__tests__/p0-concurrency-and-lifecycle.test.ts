// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  promotionFindUnique: vi.fn(),
  promotionTargetFindFirst: vi.fn(),
  productVariantFindUnique: vi.fn(),
  orderDiscountCount: vi.fn(),
  couponUsageCount: vi.fn(),
  orderDiscountFindFirst: vi.fn(),
  couponUsageFindFirst: vi.fn(),
  auditInTx: vi.fn(),
  auditFieldDiff: vi.fn(),
  assertAdminPreviewWritesAllowed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    $queryRaw: vi.fn().mockResolvedValue([]),
    promotion: { findUnique: mocks.promotionFindUnique },
    promotionTarget: { findFirst: mocks.promotionTargetFindFirst },
    productVariant: { findUnique: mocks.productVariantFindUnique },
    orderDiscount: {
      count: mocks.orderDiscountCount,
      findFirst: mocks.orderDiscountFindFirst,
    },
    couponUsage: {
      count: mocks.couponUsageCount,
      findFirst: mocks.couponUsageFindFirst,
    },
  },
}));

vi.mock("@/lib/api/audit", () => ({
  auditInTx: mocks.auditInTx,
  auditFieldDiff: mocks.auditFieldDiff,
}));

vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  isAdminReadOnlyPreviewConfigured: () => false,
  isAdminPreviewPermissionAllowed: () => true,
  isAdminPreviewLocalHost: () => false,
  assertAdminPreviewWritesAllowed: mocks.assertAdminPreviewWritesAllowed,
}));

import { addTarget, patchPromotion, putBuyGet } from "@/lib/promotions/writes";
import { patchProduct } from "@/lib/catalog/writes";

function sqlText(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  return Array.isArray(strings) ? strings.join("?") : String(strings);
}

describe("P0 concurrency & lifecycle integrity fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orderDiscountCount.mockResolvedValue(0);
    mocks.couponUsageCount.mockResolvedValue(0);
    mocks.orderDiscountFindFirst.mockResolvedValue(null);
    mocks.couponUsageFindFirst.mockResolvedValue(null);
    mocks.auditInTx.mockResolvedValue(undefined);
    mocks.auditFieldDiff.mockReturnValue(undefined);
  });

  it("addTarget VARIANT locks promotion, then parent product FOR UPDATE OF p, then product_variant FOR UPDATE, and rejects archived parent product", async () => {
    const queryCalls: string[] = [];
    mocks.promotionFindUnique.mockResolvedValue({ id: "promo-1" });
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async (...args: unknown[]) => {
          queryCalls.push(sqlText(args));
          return [];
        }),
        promotion: { findUnique: vi.fn() },
        productVariant: {
          findUnique: vi.fn().mockResolvedValue({
            isActive: true,
            deletedAt: null,
            product: { isActive: true, deletedAt: new Date("2026-10-01T00:00:00.000Z") },
          }),
        },
        promotionTarget: { create: vi.fn() },
      };
      return cb(tx);
    });

    await expect(addTarget("promo-1", "VARIANT", "var-1", "admin-1")).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });

    expect(queryCalls.length).toBe(3);
    expect(queryCalls[0]).toContain("FROM promotions");
    expect(queryCalls[0]).toContain("FOR UPDATE");
    expect(queryCalls[1]).toContain("FROM products p INNER JOIN product_variants");
    expect(queryCalls[1]).toContain("FOR UPDATE OF p");
    expect(queryCalls[2]).toContain("FROM product_variants");
    expect(queryCalls[2]).toContain("FOR UPDATE");
  });

  it("patchPromotion re-validates LINE targets INSIDE tx after FOR UPDATE lock (blocks concurrent deleteTarget race)", async () => {
    const queryCalls: string[] = [];
    mocks.promotionFindUnique.mockResolvedValue({
      id: "promo-2",
      name: "Promo 2",
      type: "PERCENTAGE",
      scope: "LINE",
      status: "DRAFT",
      startAt: null,
      endAt: null,
      targets: [{ id: "tgt-1" }],
      buyGetRules: null,
    });
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async (...args: unknown[]) => {
          queryCalls.push(sqlText(args));
          return [];
        }),
        promotion: {
          // Concurrent deleteTarget removed the last target before our lock acquired
          findUnique: vi.fn().mockResolvedValue({
            id: "promo-2",
            type: "PERCENTAGE",
            scope: "LINE",
            status: "DRAFT",
            startAt: null,
            endAt: null,
            targets: [],
            buyGetRules: null,
          }),
          update: vi.fn(),
        },
      };
      return cb(tx);
    });

    await expect(patchPromotion("promo-2", { status: "ACTIVE" }, "admin-1")).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
    expect(queryCalls.some((q) => q.includes("FROM promotions") && q.includes("FOR UPDATE"))).toBe(true);
  });

  it("putBuyGet validates and locks freeVariantId INSIDE tx (not stale pre-tx read)", async () => {
    const queryCalls: string[] = [];
    mocks.promotionFindUnique.mockResolvedValue({ id: "promo-3", type: "BUY_X_GET_Y" });
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async (...args: unknown[]) => {
          queryCalls.push(sqlText(args));
          return [];
        }),
        promotion: { findUnique: vi.fn() },
        productVariant: {
          findUnique: vi.fn().mockResolvedValue({
            isActive: false,
            deletedAt: null,
            product: { isActive: true, deletedAt: null },
          }),
        },
        promotionBuyGetRule: { upsert: vi.fn() },
      };
      return cb(tx);
    });

    await expect(
      putBuyGet(
        "promo-3",
        { buyQuantity: "2", getQuantity: "1", discountPercent: "100", freeVariantId: "var-free-1" },
        "admin-1",
      ),
    ).rejects.toMatchObject({
      code: "BUSINESS_RULE",
      message: "Free variant does not exist or is not live.",
    });

    // Global pre-tx findUnique was never called for productVariant
    expect(mocks.productVariantFindUnique).not.toHaveBeenCalled();
    expect(queryCalls.some((q) => q.includes("FROM promotions") && q.includes("FOR UPDATE"))).toBe(true);
    expect(queryCalls.some((q) => q.includes("FROM products p INNER JOIN product_variants"))).toBe(true);
    expect(queryCalls.some((q) => q.includes("FROM product_variants"))).toBe(true);
  });

  it("patchProduct locks row FOR UPDATE and rejects archived products (deletedAt !== null) with 409 CONFLICT", async () => {
    const queryCalls: string[] = [];
    const txUpdate = vi.fn();
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async (...args: unknown[]) => {
          queryCalls.push(sqlText(args));
          return [{ updated_at: new Date("2026-11-14T19:41:00.000Z") }];
        }),
        product: {
          findUnique: vi.fn().mockResolvedValue({
            id: "prod-archived",
            name: "Archived Item",
            slug: "archived-item",
            description: null,
            categoryId: "cat-1",
            brandId: null,
            productType: "PIECE",
            unit: "PIECE",
            saleStepGrams: null,
            isActive: false,
            deletedAt: new Date("2026-11-14T19:41:00.000Z"),
          }),
          update: txUpdate,
        },
      };
      return cb(tx);
    });

    let thrown: unknown;
    try {
      await patchProduct("prod-archived", { name: "Edited" }, "admin-1");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe("CONFLICT");
    expect(txUpdate).not.toHaveBeenCalled();
    expect(queryCalls.some((q) => q.includes("FROM products") && q.includes("FOR UPDATE"))).toBe(true);
  });
});
