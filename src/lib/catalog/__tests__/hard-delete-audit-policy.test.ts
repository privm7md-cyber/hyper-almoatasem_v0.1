// @vitest-environment node
// ADM-OWNER — the protected-audit definition and the hard delete's safety.
//
// OWNER DECISION (12 Nov 2026, final): not every audit row is a permanent
// obstacle. The ordinary lifecycle of a product (create, rename, hide,
// restore, archive, images, codes) is metadata — it SURVIVES the delete and
// must not stop a clean product from being removed. A protected commercial,
// financial, stock or security record DOES stop it.
//
// The twelve cases of the owner's list are pinned here, one by one.
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
  prisma: {
    $transaction: m.transaction,
    $queryRaw: m.raw,
    product: { findUnique: m.findUnique },
    ...Object.fromEntries(Object.entries(m.counts).map(([key, count]) => [key, { count }])),
  },
}));
vi.mock("@/lib/api/audit", () => ({ auditInTx: m.audit }));
vi.mock("@/lib/auth/admin-read-only-preview", () => ({
  assertAdminPreviewWritesAllowed: vi.fn(),
  isAdminReadOnlyPreviewConfigured: () => false,
}));

import {
  NON_BLOCKING_AUDIT_ACTIONS,
  classifyAuditAction,
  getProductDeletionEligibility,
  hardDeleteProduct,
  type HardDeleteInput,
} from "../hard-delete";

const ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "2026-11-12T10:00:00.000Z";
const input: HardDeleteInput = { confirmed: true, reason: "منتج نظيف", expectedUpdatedAt: TOKEN };

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

/** The audit probe answers with the two counts the module reads. */
function auditRows(protectedCount: number, totalCount: number) {
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("audit_logs")) return [{ protectedCount, totalCount }];
    if (sql.includes("promotion_targets")) return [{ count: 0 }];
    return [{ id: ID }];
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx()));
  auditRows(0, 3);
  m.findUnique.mockResolvedValue({ id: ID, name: "أرز", deletedAt: new Date(TOKEN), updatedAt: new Date(TOKEN) });
  m.variantDeleteMany.mockResolvedValue({ count: 1 });
  m.productDelete.mockResolvedValue({ id: ID });
  m.audit.mockResolvedValue(undefined);
  for (const count of Object.values(m.counts)) count.mockResolvedValue(0);
});

describe("G8 — the audit classification (lifecycle vs protected evidence)", () => {
  it.each([
    "products.create",
    "products.update",
    "products.archive",
    "products.restore",
    "variants.create",
    "variants.update",
    "images.register",
    "images.delete",
    "codes.create",
    "products.hard_delete",
  ])("%s is metadata: it does not block the delete by itself", (action) => {
    expect(classifyAuditAction(action)).toBe("METADATA");
  });

  it.each([
    "variants.price",
    "inventory.adjust",
    "inventory.commit",
    "inventory.threshold",
    "invoice.issue",
    "orders.advance",
    "anything.new.the.store.adds",
  ])("%s is protected evidence: it blocks the delete", (action) => {
    expect(classifyAuditAction(action)).toBe("PROTECTED");
  });

  it("the allow-list is the only rule the query uses", () => {
    // The SQL excludes exactly the metadata events — everything else counts.
    expect(NON_BLOCKING_AUDIT_ACTIONS).toContain("products.create");
    expect(NON_BLOCKING_AUDIT_ACTIONS).not.toContain("variants.price");
  });
});

describe("G9/G10 — the ten reference categories and the delete's safety", () => {
  it("a product with only lifecycle audit rows is executable", async () => {
    auditRows(0, 5);
    const eligibility = await getProductDeletionEligibility(ID);
    expect(eligibility.verification).toBe("VERIFIED");
    expect(eligibility.executable).toBe(true);
    expect(eligibility.blockedBy).toEqual([]);
  });

  it("a protected audit row blocks the delete", async () => {
    auditRows(2, 5);
    const eligibility = await getProductDeletionEligibility(ID);
    expect(eligibility.executable).toBe(false);
    expect(eligibility.blockedBy).toContain("protectedAudit");
  });

  it.each([
    ["orderItems", "orderItem"],
    ["orderItemReplacements", "orderItemReplacement"],
    ["inventoryMovements", "inventoryMovement"],
    ["inventoryBalances", "inventory"],
    ["cartItems", "cartItem"],
    ["priceHistory", "productPriceHistory"],
    ["buyGetFreeVariant", "promotionBuyGetRule"],
  ])("the %s reference blocks the delete", async (key, model) => {
    m.counts[model as keyof typeof m.counts].mockResolvedValue(1);
    const eligibility = await getProductDeletionEligibility(ID);
    expect(eligibility.executable).toBe(false);
    expect(eligibility.blockedBy).toContain(key);
  });

  it("the polymorphic promotion target blocks the delete", async () => {
    m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ");
      if (sql.includes("promotion_targets")) return [{ count: 1 }];
      if (sql.includes("audit_logs")) return [{ protectedCount: 0, totalCount: 1 }];
      return [{ id: ID }];
    });
    const eligibility = await getProductDeletionEligibility(ID);
    expect(eligibility.executable).toBe(false);
    expect(eligibility.blockedBy).toContain("promotionTargets");
  });

  it("a failure in the indirect reference check refuses the delete conservatively", async () => {
    m.counts.productPriceHistory.mockRejectedValue(new Error("unavailable"));
    const eligibility = await getProductDeletionEligibility(ID);
    // The check did NOT complete: it is reported as unconfirmed, never as clean.
    expect(eligibility.verification).toBe("FAILED");
    expect(eligibility.executable).toBe(false);
  });

  it("the delete itself still fails closed when a reference read fails", async () => {
    m.counts.orderItem.mockRejectedValue(new Error("unavailable"));
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toThrow("unavailable");
    expect(m.productDelete).not.toHaveBeenCalled();
  });

  it("the delete runs LOCK → RECHECK → DELETE → PRESERVE AUDIT", async () => {
    const result = await hardDeleteProduct(ID, input, ACTOR);
    expect(result.deleted).toBe(true);
    // The lock comes first.
    const lockIndex = m.raw.mock.invocationCallOrder[0];
    expect(lockIndex).toBeLessThan(m.counts.orderItem.mock.invocationCallOrder[0]);
    // The re-check happens inside the transaction, before the delete.
    expect(m.counts.orderItem.mock.invocationCallOrder[0]).toBeLessThan(
      m.variantDeleteMany.mock.invocationCallOrder[0],
    );
    // The audit trail is written, and the previous rows are NOT touched.
    expect(m.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "products.hard_delete", userId: ACTOR, reason: input.reason }),
    );
    expect(m.audit.mock.calls[0][1].oldValues).not.toHaveProperty("auditRows");
  });

  it("a failure after the lock rolls the whole thing back", async () => {
    m.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toThrow("audit unavailable");
  });

  it("a repeated request never deletes twice", async () => {
    await hardDeleteProduct(ID, input, ACTOR);
    m.findUnique.mockResolvedValue(null);
    await expect(hardDeleteProduct(ID, input, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(m.productDelete).toHaveBeenCalledTimes(1);
  });
});
