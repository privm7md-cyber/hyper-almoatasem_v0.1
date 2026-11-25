// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  auditInTx: vi.fn(),
  previewConfigured: false,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: m.transaction,
  },
}));

vi.mock("@/lib/api/audit", () => ({
  auditInTx: m.auditInTx,
}));

vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  isAdminReadOnlyPreviewConfigured: () => m.previewConfigured,
  isAdminPreviewPermissionAllowed: (p: string) => !m.previewConfigured || p.endsWith(".view"),
  isAdminPreviewLocalHost: () => false,
  assertAdminPreviewWritesAllowed: () => {
    if (m.previewConfigured) throw new ApiError("FORBIDDEN", "Admin read-only preview.");
  },
}));

import {
  analyzeProductUnitAndWeightConsistency,
  validateCatalogImportBatch,
  validateProductCodeFormat,
} from "@/lib/catalog/data-quality";
import {
  computeAdjustedPrice,
  previewOrApplyBulkProductOperation,
} from "@/lib/catalog/bulk-operations";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const CAT_NEW = "33333333-3333-4333-8333-333333333333";

describe("POS & catalog data-quality validators", () => {
  it("validateProductCodeFormat rejects 0 placeholders, 11-digit POS truncations, and bad EAN-13 check digits while accepting valid EAN-13", () => {
    expect(validateProductCodeFormat("0", "BARCODE")).toMatchObject({ valid: false, reason: "zero_placeholder" });
    expect(validateProductCodeFormat("61938600001", "BARCODE")).toMatchObject({ valid: false, reason: "short_numeric_corrupt" });
    expect(validateProductCodeFormat("6221007000119", "BARCODE")).toMatchObject({ valid: false, reason: "bad_ean13_check_digit" });
    expect(validateProductCodeFormat("6221007000112", "BARCODE")).toMatchObject({ valid: true, reason: "ok" });
    expect(validateProductCodeFormat("INT-0012", "INTERNAL_CODE")).toMatchObject({ valid: true, reason: "ok" });
  });

  it("treats GRAM as valid package metadata on PIECE while still reporting name tokens and missing values", () => {
    const res = analyzeProductUnitAndWeightConsistency({
      name: "أرز أبيض مصري 1كجم",
      productType: "PIECE",
      unit: "PIECE",
      saleStepGrams: null,
      variants: [{ sizeValue: null, sizeUnit: "KG" }],
    });
    expect(res.dbRuleValid).toBe(true);
    expect(res.hasWeightShapeMismatch).toBe(false);
    expect(res.hasWeightTokenOnPieceName).toBe(true);
    expect(res.missingVariantSizeValueCount).toBe(1);
    expect(res.missingVariantSizeUnitCount).toBe(0);

    const badWeight = analyzeProductUnitAndWeightConsistency({
      name: "جبنة قريش",
      productType: "WEIGHT",
      unit: "PIECE",
      saleStepGrams: null,
      variants: [{ sizeValue: "250", sizeUnit: "GRAM" }],
    });
    expect(badWeight.dbRuleValid).toBe(false);
  });

  it("validateCatalogImportBatch separates blockers (duplicate/corrupt codes, negative stock) from warnings (sector divergence, <1 EGP, mojibake)", () => {
    const res = validateCatalogImportBatch([
      {
        rowNumber: 1,
        code: "6221007000112",
        name: "حليب طبيعي 1 لتر",
        productType: "PIECE",
        unit: "PIECE",
        price: "42.50",
        sectorPrice: "40.00",
        stockQty: 12,
        sizeValue: "1",
        sizeUnit: "LITER",
      },
      {
        rowNumber: 2,
        code: "6221007000112",
        name: "Ø³ÙƒØ± Ø£Ø¨ÙŠØ¶",
        productType: "PIECE",
        unit: "PIECE",
        price: "0.50",
        stockQty: -5,
        sizeValue: "1",
        sizeUnit: "KG",
      },
    ]);

    expect(res.validRowCount).toBe(1);
    expect(res.rejectedRowCount).toBe(1);
    expect(res.summary.duplicateCodes).toBe(1);
    expect(res.summary.negativeStockRows).toBe(1);
    expect(res.summary.sectorVsSellDivergences).toBe(1);
    expect(res.summary.subOneEgpPrices).toBe(1);
    expect(res.summary.nameReviewRows).toBe(1);
  });
});

describe("Bulk catalog operations", () => {
  afterEach(()=>vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET","synthetic-bulk-preview-secret-00000000000000000000");
    vi.clearAllMocks();
    m.previewConfigured = false;
    m.auditInTx.mockResolvedValue(undefined);
  });

  it("rejects duplicate productIds, missing reason, or dryRun=false without confirmed=true", async () => {
    await expect(
      previewOrApplyBulkProductOperation(
        { action: "DEACTIVATE", productIds: [UUID_1, UUID_1], reason: "مراجعة دفعة", dryRun: true },
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      previewOrApplyBulkProductOperation(
        { action: "DEACTIVATE", productIds: [UUID_1], reason: "ab", dryRun: true },
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      previewOrApplyBulkProductOperation(
        { action: "DEACTIVATE", productIds: [UUID_1], reason: "سبب صحيح للتعديل", dryRun: false },
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("blocks apply in Admin Read-Only Preview mode before touching the database", async () => {
    m.previewConfigured = true;
    await expect(
      previewOrApplyBulkProductOperation(
        {
          action: "DEACTIVATE",
          productIds: [UUID_1],
          reason: "اختبار وضع المعاينة",
          dryRun: false,
          confirmed: true,
        },
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("computeAdjustedPrice uses exact integer-piaster arithmetic and flags unchanged prices cleanly", () => {
    expect(computeAdjustedPrice("100.00", "PERCENT", "10")).toEqual({ newPrice: "110.00", changed: true });
    expect(computeAdjustedPrice("10.00", "PERCENT", "0.01")).toEqual({ newPrice: "10.00", changed: false });
    expect(computeAdjustedPrice("19.99", "FIXED_DELTA", "0.01")).toEqual({ newPrice: "20.00", changed: true });
    expect(() => computeAdjustedPrice("5.00", "FIXED_DELTA", "-5.00")).toThrow();
  });

  it("dryRun=true returns full before/after preview without writing, and ADJUST_PRICE apply skips productPriceHistory when variant price is unchanged", async () => {
    const productUpdate = vi.fn();
    const variantUpdate = vi.fn();
    const priceHistoryCreate = vi.fn();
    const queryRaw = vi.fn().mockResolvedValue([]);

    m.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        $queryRaw: queryRaw,
        product: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: UUID_1,
              name: "شاي 250 جم",
              categoryId: CAT_NEW,
              brandId: null,
              isActive: true,
              deletedAt: null,
              category: { name: "المشروبات" },
              brand: null,
              variants: [
                { id: UUID_2, name: "افتراضي", price: "10.00" },
              ],
            },
          ]),
          update: productUpdate,
        },
        productVariant: { update: variantUpdate },
        productPriceHistory: { create: priceHistoryCreate },
        category: { findFirst: vi.fn() },
        brand: { findFirst: vi.fn() },
      }),
    );

    const previewRes = await previewOrApplyBulkProductOperation(
      {
        action: "ADJUST_PRICE",
        productIds: [UUID_1],
        reason: "تجربة زيادة سعر",
        dryRun: true,
        priceMode: "PERCENT",
        amount: "10",
      },
      "admin-1",
    );
    expect(previewRes.applied).toBe(false);
    expect(previewRes.summary.willChangeCount).toBe(1);
    expect(previewRes.items[0].variantChanges[0]).toMatchObject({
      oldPrice: "10.00",
      newPrice: "11.00",
      changed: true,
    });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(variantUpdate).not.toHaveBeenCalled();

    // Now test an adjustment small enough that 10.00 + 0.01% rounds back to 10.00 -> must NOT insert price history
    const unchangedPreview=await previewOrApplyBulkProductOperation({action:"ADJUST_PRICE",productIds:[UUID_1],reason:"تعديل طفيف لا يغير السعر الفعلي",dryRun:true,priceMode:"PERCENT",amount:"0.01"},"admin-1");
    const applyUnchanged = await previewOrApplyBulkProductOperation(
      {
        action: "ADJUST_PRICE",
        productIds: [UUID_1],
        reason: "تعديل طفيف لا يغير السعر الفعلي",
        dryRun: false,
        confirmed: true,
        previewReceipt:unchangedPreview.previewReceipt,
        priceMode: "PERCENT",
        amount: "0.01",
      },
      "admin-1",
    );
    expect(applyUnchanged.applied).toBe(true);
    expect(applyUnchanged.summary.updatedVariantCount).toBe(0);
    expect(applyUnchanged.summary.skippedUnchangedVariants).toBe(1);
    expect(variantUpdate).not.toHaveBeenCalled();
    expect(priceHistoryCreate).not.toHaveBeenCalled();
  });

  it("aborts the entire batch atomically with CONFLICT if any selected product is archived", async () => {
    const productUpdate = vi.fn();
    m.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        $queryRaw: vi.fn().mockResolvedValue([]),
        product: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: UUID_1,
              name: "منتج نشط",
              categoryId: CAT_NEW,
              brandId: null,
              isActive: true,
              deletedAt: null,
              category: { name: "المشروبات" },
              brand: null,
              variants: [],
            },
            {
              id: UUID_2,
              name: "منتج مؤرشف",
              categoryId: CAT_NEW,
              brandId: null,
              isActive: false,
              deletedAt: new Date("2026-11-14T19:41:00.000Z"),
              category: { name: "المشروبات" },
              brand: null,
              variants: [],
            },
          ]),
          update: productUpdate,
        },
        category: { findFirst: vi.fn() },
        brand: { findFirst: vi.fn() },
      }),
    );

    await expect(
      previewOrApplyBulkProductOperation(
        {
          action: "DEACTIVATE",
          productIds: [UUID_1, UUID_2],
          reason: "إخفاء دفعة",
          dryRun: false,
          confirmed: true,
        },
        "admin-1",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(productUpdate).not.toHaveBeenCalled();
  });
});
