// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  audit: vi.fn(),
  previewConfigured: false,
}));

vi.mock("@/lib/db", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  assertAdminPreviewWritesAllowed: () => {
    if (m.previewConfigured) throw new ApiError("FORBIDDEN", "وضع المعاينة للقراءة فقط.");
  },
}));

import { previewOrApplyMetadataReview } from "@/lib/catalog/metadata-review";

const VARIANT = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

function row(productType = "PIECE", sizeValue: string | null = null, sizeUnit: string | null = null) {
  return {
    id: VARIANT,
    name: "العبوة الأساسية",
    sizeValue,
    sizeUnit,
    deletedAt: null,
    productId: PRODUCT,
    product: {
      name: "منتج 500 جرام",
      productType,
      unit: productType === "PIECE" ? "PIECE" : "KG",
      deletedAt: null,
      variants: [{ id: VARIANT, name: "العبوة الأساسية" }],
    },
  };
}

describe("metadata review transaction", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "synthetic-metadata-preview-secret-000000000000000");
    m.previewConfigured = false;
    m.audit.mockResolvedValue(undefined);
  });

  it("previews then applies a packaged PIECE correction with the signed receipt and audit in one transaction", async () => {
    const update = vi.fn().mockResolvedValue({});
    const queryRaw = vi.fn().mockResolvedValue([]);
    m.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: queryRaw,
      productVariant: { findMany: vi.fn().mockResolvedValue([row()]), update },
    }));
    const base = {
      corrections: [{ variantId: VARIANT, sizeValue: "500", sizeUnit: "GRAM" }],
      reason: "تصحيح حجم عبوة موثق",
    };
    const preview = await previewOrApplyMetadataReview({ ...base, dryRun: true }, ACTOR);
    expect(preview.summary).toMatchObject({ ready: 1, rejected: 0, updated: 0 });
    expect(update).not.toHaveBeenCalled();

    const applied = await previewOrApplyMetadataReview({ ...base, dryRun: false, confirmed: true, previewReceipt: preview.previewReceipt }, ACTOR);
    expect(applied.summary.updated).toBe(1);
    expect(queryRaw).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: VARIANT }, data: { sizeValue: "500", sizeUnit: "GRAM" } });
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "variants.update", entityId: VARIANT }));
  });

  it("reports a WEIGHT/GRAM correction as rejected and writes nothing", async () => {
    const update = vi.fn();
    m.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      productVariant: { findMany: vi.fn().mockResolvedValue([row("WEIGHT")]), update },
    }));
    const preview = await previewOrApplyMetadataReview({
      corrections: [{ variantId: VARIANT, sizeValue: "250", sizeUnit: "GRAM" }],
      reason: "مراجعة تعارض الوحدة",
      dryRun: true,
    }, ACTOR);
    expect(preview.summary).toMatchObject({ ready: 0, rejected: 1 });
    expect(preview.rejectedRows[0].reasons).toContain("WEIGHT_PRICE_BASIS_CONFLICT");
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks mutation in read-only preview mode before opening a transaction", async () => {
    m.previewConfigured = true;
    await expect(previewOrApplyMetadataReview({
      corrections: [{ variantId: VARIANT, sizeValue: "500", sizeUnit: "GRAM" }],
      reason: "اختبار منع الكتابة",
      dryRun: false,
      confirmed: true,
      previewReceipt: "not-used",
    }, ACTOR)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
