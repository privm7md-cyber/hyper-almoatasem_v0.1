// @vitest-environment node
// ADM-OWNER G2 — the catalogue lock protocol (the other half of the hard
// delete's safety).
//
// A promotion target has NO foreign key, so the only thing that stops an
// offer from attaching to a product that is being finally deleted is the
// lock: the target writer locks the catalogue row, and the delete locks the
// same row. These tests pin the writer's half.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  promoFindUnique: vi.fn(),
  promoTargetCreate: vi.fn(),
  promoTargetDelete: vi.fn(),
  promoTargetFindFirst: vi.fn(),
  raw: vi.fn(),
  productFindUnique: vi.fn(),
  variantFindUnique: vi.fn(),
  brandFindUnique: vi.fn(),
  categoryFindUnique: vi.fn(),
  audit: vi.fn(),
  queryRawReferenced: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: m.transaction,
    promotion: { findUnique: m.promoFindUnique },
    promotionTarget: { create: m.promoTargetCreate, delete: m.promoTargetDelete, findFirst: m.promoTargetFindFirst },
    product: { findUnique: m.productFindUnique },
    productVariant: { findUnique: m.variantFindUnique },
    brand: { findUnique: m.brandFindUnique },
    category: { findUnique: m.categoryFindUnique },
    $queryRaw: m.queryRawReferenced,
  },
}));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));

import { addTarget, deleteTarget } from "../writes";

const PROMO = "00000000-0000-4000-8000-0000000000p1".replace("p", "0");
const PRODUCT = "00000000-0000-4000-8000-0000000000a1".replace("a", "0");
const ACTOR = "00000000-0000-4000-8000-0000000000b1".replace("b", "0");

function tx() {
  return {
    $queryRaw: m.raw,
    promotionTarget: { create: m.promoTargetCreate, delete: m.promoTargetDelete },
    product: { findUnique: m.productFindUnique },
    productVariant: { findUnique: m.variantFindUnique },
    brand: { findUnique: m.brandFindUnique },
    category: { findUnique: m.categoryFindUnique },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.promoFindUnique.mockResolvedValue({ id: PROMO });
  m.queryRawReferenced.mockResolvedValue([]);
  m.raw.mockResolvedValue([]);
  m.promoTargetCreate.mockResolvedValue({ id: "target-1", promotionId: PROMO, targetType: "PRODUCT", targetId: PRODUCT });
  m.promoTargetFindFirst.mockResolvedValue({ id: "target-1", targetType: "PRODUCT", targetId: PRODUCT });
  m.productFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
  m.variantFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
  m.brandFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
  m.categoryFindUnique.mockResolvedValue({ isActive: true, deletedAt: null });
  m.audit.mockResolvedValue(undefined);
});

describe("G2 — the catalogue lock protocol on the promotion writer", () => {
  it("locks the product row before the target row is written", async () => {
    await addTarget(PROMO, "PRODUCT", PRODUCT, ACTOR);
    const sql = m.raw.mock.calls.map((call) => call[0].join("?")).join(" | ");
    expect(sql).toMatch(/FROM products WHERE id = \?::uuid FOR UPDATE/);
    // The lock comes BEFORE the create.
    expect(m.raw.mock.invocationCallOrder[0]).toBeLessThan(m.promoTargetCreate.mock.invocationCallOrder[0]);
  });

  it("locks the variant row for a VARIANT target", async () => {
    await addTarget(PROMO, "VARIANT", PRODUCT, ACTOR);
    const sql = m.raw.mock.calls.map((call) => call[0].join("?")).join(" | ");
    expect(sql).toMatch(/FROM product_variants WHERE id = \?::uuid FOR UPDATE/);
  });

  it("re-checks the target's liveness INSIDE the transaction, after the lock", async () => {
    // The target disappeared (the delete won the race): the write is refused.
    m.productFindUnique.mockResolvedValue(null);
    await expect(addTarget(PROMO, "PRODUCT", PRODUCT, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.promoTargetCreate).not.toHaveBeenCalled();
  });

  it("refuses a target that is archived or inactive", async () => {
    m.productFindUnique.mockResolvedValue({ isActive: false, deletedAt: null });
    await expect(addTarget(PROMO, "PRODUCT", PRODUCT, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    m.productFindUnique.mockResolvedValue({ isActive: true, deletedAt: new Date() });
    await expect(addTarget(PROMO, "PRODUCT", PRODUCT, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.promoTargetCreate).not.toHaveBeenCalled();
  });

  it("takes the same lock when a target is removed", async () => {
    await deleteTarget(PROMO, "target-1", ACTOR);
    const sql = m.raw.mock.calls.map((call) => call[0].join("?")).join(" | ");
    expect(sql).toMatch(/FROM products WHERE id = \?::uuid FOR UPDATE/);
    expect(m.raw.mock.invocationCallOrder[0]).toBeLessThan(m.promoTargetDelete.mock.invocationCallOrder[0]);
  });

  it("a brand or category target needs no catalogue lock (they are never deleted)", async () => {
    await addTarget(PROMO, "BRAND", PRODUCT, ACTOR);
    expect(m.raw).not.toHaveBeenCalled();
    expect(m.promoTargetCreate).toHaveBeenCalled();
  });
});
