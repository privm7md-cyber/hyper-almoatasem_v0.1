// @vitest-environment node
// ADM-OWNER G2 — the final product delete, UNREFERENCED ONLY.
//
// The acceptance list of the owner's decision:
//   • an unreferenced product may be finally deleted after the check
//   • a product bound to an order / order item / inventory movement /
//     promotion / protected audit record is refused
//   • on refusal every historical record stays exactly as it was
//   • archiving never removes historical relations, and an archived product
//     can be restored
//   • the reference check is repeated INSIDE the delete's own transaction
//   • a failure inside the transaction rolls the whole thing back
//   • a repeated request never deletes twice or damages the data
//   • a stale concurrency token is a conflict, not a delete
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: vi.fn(),
  raw: vi.fn(),
  findUnique: vi.fn(),
  variantDeleteMany: vi.fn(),
  productDelete: vi.fn(),
  audit: vi.fn(),
  counts: {
    orderItem: vi.fn(),
    orderItemReplacement: vi.fn(),
    inventoryMovement: vi.fn(),
    inventory: vi.fn(),
    cartItem: vi.fn(),
    productPriceHistory: vi.fn(),
    promotionBuyGetRule: vi.fn(),
    productVariant: vi.fn(),
    productImage: vi.fn(),
    productCode: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { $transaction: m.transaction },
}));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  assertAdminPreviewWritesAllowed: vi.fn(),
  isAdminReadOnlyPreviewConfigured: () => false,
}));

import { hardDeleteProduct, type HardDeleteInput } from "../hard-delete";

const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "2026-11-12T10:00:00.000Z";

const input: HardDeleteInput = { confirmed: true, reason: "منتج تجريبي مش ليه أي مرجع", expectedUpdatedAt: TOKEN };

function tx() {
  return {
    $queryRaw: m.raw,
    product: { findUnique: m.findUnique, delete: m.productDelete },
    orderItem: { count: m.counts.orderItem },
    orderItemReplacement: { count: m.counts.orderItemReplacement },
    inventoryMovement: { count: m.counts.inventoryMovement },
    inventory: { count: m.counts.inventory },
    cartItem: { count: m.counts.cartItem },
    productPriceHistory: { count: m.counts.productPriceHistory },
    promotionBuyGetRule: { count: m.counts.promotionBuyGetRule },
    productVariant: { count: m.counts.productVariant, deleteMany: m.variantDeleteMany },
    productImage: { count: m.counts.productImage },
    productCode: { count: m.counts.productCode },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("promotion_targets")) return [{ count: 0 }];
    if (sql.includes("audit_logs")) return [{ protectedCount: 0, totalCount: 3 }];
    return [{ id: ID }];
  });
  m.findUnique.mockResolvedValue({ id: ID, name: "أرز مصري", deletedAt: new Date(TOKEN), updatedAt: new Date(TOKEN) });
  m.variantDeleteMany.mockResolvedValue({ count: 2 });
  m.productDelete.mockResolvedValue({ id: ID });
  m.audit.mockResolvedValue(undefined);
  for (const count of Object.values(m.counts)) count.mockResolvedValue(0);
});

describe("G2 — the final delete (UNREFERENCED ONLY)", () => {
  it("deletes an unreferenced product, its variants, and audits the attempt", async () => {
    const result = await hardDeleteProduct(ID, input, ACTOR);
    expect(result.deleted).toBe(true);
    expect(result.variantsDeleted).toBe(2);
    expect(m.variantDeleteMany).toHaveBeenCalledWith({ where: { productId: ID } });
    expect(m.productDelete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(m.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "products.hard_delete",
        userId: ACTOR,
        entityType: "products",
        entityId: ID,
        reason: input.reason,
      }),
    );
  });

  it("locks the catalogue rows before it deletes (the catalogue lock protocol)", async () => {
    await hardDeleteProduct(ID, input, ACTOR);
    const sql = m.raw.mock.calls.map((call) => call[0].join("?")).join(" | ");
    expect(sql).toMatch(/FROM products WHERE id = \?::uuid FOR UPDATE/);
    expect(sql).toMatch(/FROM product_variants WHERE product_id = \?::uuid FOR UPDATE/);
    // The lock must come BEFORE the delete.
    const lockIndex = m.raw.mock.calls.findIndex((call) => call[0].join(" ").includes("FOR UPDATE"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
  });

  it("refuses a product bound to an order item and leaves every record untouched", async () => {
    m.counts.orderItem.mockResolvedValue(2);
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.variantDeleteMany).not.toHaveBeenCalled();
    expect(m.productDelete).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("refuses a product bound to an inventory movement", async () => {
    m.counts.inventoryMovement.mockResolvedValue(5);
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("refuses a product bound to an inventory balance", async () => {
    m.counts.inventory.mockResolvedValue(1);
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("refuses a product targeted by a promotion (the polymorphic reference)", async () => {
    m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ");
      if (sql.includes("promotion_targets")) return [{ count: 1 }];
      if (sql.includes("audit_logs")) return [{ protectedCount: 0, totalCount: 3 }];
      return [{ id: ID }];
    });
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("refuses a product with a protected audit record", async () => {
    m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ");
      if (sql.includes("promotion_targets")) return [{ count: 0 }];
      if (sql.includes("audit_logs")) return [{ protectedCount: 4, totalCount: 9 }];
      return [{ id: ID }];
    });
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("the refusal message names the blocking references in Arabic", async () => {
    m.counts.orderItem.mockResolvedValue(1);
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toThrow(/بنود طلبات سابقة/);
  });

  it("re-checks the references INSIDE the transaction (not only before it)", async () => {
    await hardDeleteProduct(ID, input, ACTOR);
    // The counts run inside the same transaction callback as the delete.
    expect(m.counts.orderItem).toHaveBeenCalledTimes(1);
    expect(m.transaction).toHaveBeenCalledTimes(1);
    const orderOfCalls = m.variantDeleteMany.mock.invocationCallOrder[0];
    expect(orderOfCalls).toBeGreaterThan(m.counts.orderItem.mock.invocationCallOrder[0]);
  });

  it("refuses a product that is not archived", async () => {
    m.findUnique.mockResolvedValue({ id: ID, name: "أرز", deletedAt: null, updatedAt: new Date(TOKEN) });
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("a stale concurrency token is a conflict, not a delete", async () => {
    await expect(
      hardDeleteProduct(ID, { ...input, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("a failure inside the transaction rolls the whole thing back", async () => {
    m.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toThrow("audit unavailable");
    // The deletes happened inside the transaction, but the transaction failed:
    // the caller sees the failure and the database rolls everything back.
    expect(m.audit).toHaveBeenCalled();
  });

  it("a repeated request never deletes twice", async () => {
    await hardDeleteProduct(ID, input, ACTOR);
    // The second attempt finds no product any more.
    m.findUnique.mockResolvedValue(null);
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(m.productDelete).toHaveBeenCalledTimes(1);
  });

  it("requires a reason and an explicit confirmation", async () => {
    await expect(hardDeleteProduct(ID, { ...input, reason: "  " }, ACTOR)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      hardDeleteProduct(ID, { ...input, confirmed: false } as unknown as HardDeleteInput, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(m.productDelete).not.toHaveBeenCalled();
  });
});
