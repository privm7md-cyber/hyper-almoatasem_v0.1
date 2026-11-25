// @vitest-environment node
// The read-only deletion eligibility snapshot (ADM-OWNER G2, UNREFERENCED ONLY).
//
// The snapshot is what the screen shows; it is NEVER permission and NEVER
// proof that the delete may run (the delete re-checks inside its own
// transaction). The properties pinned here are the ones that must survive the
// owner's policy change: no PII leaks, no status-based filtering (a deleted
// variant's history still counts), polymorphic promotion targets are counted
// by their catalogue identity, and a failed read fails CLOSED.
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const names = ["inventory", "inventoryMovement", "productPriceHistory", "cartItem", "orderItem", "orderItemReplacement", "promotionBuyGetRule", "productVariant", "productImage", "productCode"] as const;
  return { transaction: vi.fn(), find: vi.fn(), raw: vi.fn(), counters: Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<typeof names[number], ReturnType<typeof vi.fn>> };
});
const models = { inventoryBalances: "inventory", inventoryMovements: "inventoryMovement", priceHistory: "productPriceHistory", cartItems: "cartItem", orderItems: "orderItem", orderItemReplacements: "orderItemReplacement", buyGetFreeVariant: "promotionBuyGetRule" } as const;
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: m.transaction,
    $queryRaw: m.raw,
    product: { findUnique: m.find },
    ...Object.fromEntries(Object.entries(m.counters).map(([key, count]) => [key, { count }])),
  },
}));
vi.mock("@/lib/api/audit", () => ({ auditInTx: () => { throw new Error("Eligibility must not audit or mutate"); } }));
import { PRODUCT_REFERENCE_MAP, getProductDeletionEligibility } from "../hard-delete";
const ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "2026-11-12T10:00:00.000Z";
const tx = { product: { findUnique: m.find }, $queryRaw: m.raw, ...Object.fromEntries(Object.entries(m.counters).map(([key, count]) => [key, { count }])) };

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation((fn) => fn(tx));
  m.find.mockResolvedValue({ name: "أرز مصري", deletedAt: new Date(TOKEN), updatedAt: new Date(TOKEN) });
  for (const count of Object.values(m.counters)) count.mockResolvedValue(0);
  // The two raw probes: promotion targets, then the audit trail.
  m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ").replace(/\s+/g, " ");
    if (sql.includes("promotion_targets")) return [{ count: 0 }];
    return [{ protectedCount: 0, totalCount: 17 }];
  });
});

describe("read-only deletion eligibility (UNREFERENCED ONLY)", () => {
  it("a product with no protected reference is executable, and the ordinary audit trail does not block it", async () => {
    const result = await getProductDeletionEligibility(ID);
    expect(result.archived).toBe(true);
    expect(result.executable).toBe(true);
    expect(result.blockedBy).toEqual([]);
    expect(result.limitation).toBeNull();
    expect(result.metadata).toEqual({ variants: 0, images: 0, codes: 0 });
    // The lifecycle trail is reported, not treated as a blocker.
    expect(result.references.find((r) => r.key === "auditHistory")?.count).toBe(17);
    expect(result.references.find((r) => r.key === "auditHistory")?.protected).toBe(false);
  });

  it.each(["orderItems", "orderItemReplacements", "inventoryMovements", "inventoryBalances", "cartItems", "priceHistory", "promotionTargets", "buyGetFreeVariant"])(
    "a protected reference (%s) blocks the delete and is explained in Arabic",
    async (key) => {
      if (key === "promotionTargets") {
        m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
          const sql = strings.join(" ").replace(/\s+/g, " ");
          if (sql.includes("promotion_targets")) return [{ count: 3 }];
          return [{ protectedCount: 0, totalCount: 17 }];
        });
      } else {
        m.counters[models[key as keyof typeof models]].mockResolvedValue(3);
      }
      const result = await getProductDeletionEligibility(ID);
      expect(result.executable).toBe(false);
      expect(result.blockedBy).toContain(key);
      const reference = result.references.find((r) => r.key === key)!;
      expect(reference.count).toBe(3);
      expect(reference.protected).toBe(true);
      expect(reference.reason.length).toBeGreaterThan(10);
      expect(JSON.stringify(result)).not.toMatch(/email|phone|customer|orderId|price:|quantity|userId|entityId/);
    },
  );

  it("a protected audit record blocks the delete", async () => {
    m.raw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ");
      if (sql.includes("promotion_targets")) return [{ count: 0 }];
      return [{ protectedCount: 2, totalCount: 9 }];
    });
    const result = await getProductDeletionEligibility(ID);
    expect(result.executable).toBe(false);
    expect(result.blockedBy).toContain("protectedAudit");
  });

  it("counts ALL variant inventory records, not just nonzero available quantities", async () => {
    m.counters.inventory.mockResolvedValue(2); // one zero row, one archived variant row
    const result = await getProductDeletionEligibility(ID);
    expect(result.references.find((r) => r.key === "inventoryBalances")?.count).toBe(2);
    expect(m.counters.inventory).toHaveBeenCalledWith({ where: { variant: { productId: ID } } });
  });

  it("never filters away inactive/deleted variants, expired carts, cancelled orders, old movements or price history", async () => {
    await getProductDeletionEligibility(ID);
    for (const key of ["inventory", "inventoryMovement", "productPriceHistory", "cartItem", "orderItem", "productCode"] as const) {
      expect(m.counters[key]).toHaveBeenCalledWith({ where: { variant: { productId: ID } } });
    }
    expect(m.counters.productVariant).toHaveBeenCalledWith({ where: { productId: ID } });
    const queries = JSON.stringify(Object.values(m.counters).map((fn) => fn.mock.calls));
    expect(queries).not.toMatch(/deletedAt|isActive|status|quantity|expiresAt|createdAt/);
  });

  it("checks replacement substitute, original and materialized items, without status exclusions", async () => {
    await getProductDeletionEligibility(ID);
    const linked = { variant: { productId: ID } };
    expect(m.counters.orderItemReplacement).toHaveBeenCalledWith({ where: { OR: [
      { replacementVariant: { productId: ID } }, { originalItem: linked }, { materializedItem: linked },
    ] } });
    expect(m.counters.promotionBuyGetRule).toHaveBeenCalledWith({ where: { freeVariant: { productId: ID } } });
  });

  it("polymorphic PRODUCT and VARIANT targets are counted for all promotions by their catalog identity", async () => {
    await getProductDeletionEligibility(ID);
    const sql = m.raw.mock.calls[0][0].join("?");
    expect(sql).toMatch(/target_type = 'PRODUCT' AND target_id = \?::uuid/);
    expect(sql).toMatch(/JOIN product_variants v ON v.id = t.target_id/);
    expect(sql).toMatch(/target_type = 'VARIANT' AND v.product_id = \?::uuid/);
    expect(sql).not.toMatch(/promotions\s|status|deleted_at|is_active/);
  });

  it("images, codes and structural variants are metadata dependents, not blockers", async () => {
    m.counters.productImage.mockResolvedValue(5); m.counters.productCode.mockResolvedValue(7); m.counters.productVariant.mockResolvedValue(9);
    const result = await getProductDeletionEligibility(ID);
    expect(result.metadata).toEqual({ images: 5, codes: 7, variants: 9 });
    expect(result.blockedBy).toEqual([]);
    const keys = result.references.map((r) => r.key);
    expect(keys).not.toContain("category"); expect(keys).not.toContain("brand"); expect(keys).not.toContain("invoice");
  });

  it("every reference in the map is classified as protected or informational", async () => {
    const result = await getProductDeletionEligibility(ID);
    expect(result.references.map((r) => r.key).sort()).toEqual(PRODUCT_REFERENCE_MAP.map((r) => r.key).sort());
    for (const reference of result.references) {
      expect(typeof reference.protected).toBe("boolean");
      expect(reference.label.length).toBeGreaterThan(3);
    }
  });

  it("rejects a missing product before dependency reads", async () => {
    m.find.mockResolvedValue(null);
    await expect(getProductDeletionEligibility(ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const count of Object.values(m.counters)) expect(count).not.toHaveBeenCalled(); expect(m.raw).not.toHaveBeenCalled();
  });

  it("failed dependency reads are reported as UNCONFIRMED, never as an empty/eligible result", async () => {
    m.counters.productPriceHistory.mockRejectedValue(new Error("unavailable"));
    const result = await getProductDeletionEligibility(ID);
    // The check did not complete. It is reported as unconfirmed and the delete
    // stays out of reach — it is never read as "clean".
    expect(result.verification).toBe("FAILED");
    expect(result.executable).toBe(false);
    expect(result.blockedBy).toEqual([]);
  });
});
