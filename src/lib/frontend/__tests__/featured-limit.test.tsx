// D13 closure tests (Final Closure campaign): the featured shelf limit contract.
// Owner decision D13: FEATURED_LIMIT=8 is the approved bound for Phase-05 closure.
// Fixture-isolated (no DB): verifies the bound is BOUNDED (single request, exact
// limit param), ordering keys, and that the UI never duplicates or fabricates cards
// when the source returns 0/1/8/(more than 8 — defensive; DB cap is 8).
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/catalog/queries", () => ({
  getBrand: vi.fn(),
  getCategory: vi.fn(),
  getProduct: vi.fn(),
  listBrands: vi.fn(),
  listCategories: vi.fn(),
  listProducts: vi.fn(),
  listVariantsByProduct: vi.fn(),
}));
vi.mock("@/lib/inventory/queries", () => ({
  getInventory: vi.fn(),
  productHasInventoryRows: vi.fn(),
  getProductStockStatus: vi.fn(),
  hasAnyInventoryRows: vi.fn(),
}));
vi.mock("@/lib/catalog/media", () => ({ listImages: vi.fn() }));
vi.mock("@/lib/catalog/search", () => ({ searchProducts: vi.fn() }));

import { listProducts } from "@/lib/catalog/queries";
import { listVariantsByProduct } from "@/lib/catalog/queries";
import { productHasInventoryRows, getProductStockStatus } from "@/lib/inventory/queries";
import { listImages } from "@/lib/catalog/media";
import { getFeaturedProducts } from "../storefront-reads";

const listProductsMock = vi.mocked(listProducts);
const listVariantsByProductMock = vi.mocked(listVariantsByProduct);

function row(i: number) {
  return {
    id: `10000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    name: `منتج ${i}`,
    slug: `p-${i}`,
    unit: "PIECE",
    productType: "PIECE",
    saleStepGrams: null,
    brand: null,
    category: { id: `c${i}`, name: "قسم", slug: `cat-${i}` },
    isActive: true,
    deletedAt: null,
  };
}

function nRows(n: number) {
  return Array.from({ length: n }, (_, i) => row(i));
}

beforeEach(() => {
  vi.clearAllMocks();
  listVariantsByProductMock.mockResolvedValue({ rows: [], nextCursor: null });
  (productHasInventoryRows as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  (getProductStockStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (listImages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("getFeaturedProducts (D13 limit contract)", () => {
  it("issues ONE bounded request with the exact limit 8 and created_at desc", async () => {
    listProductsMock.mockResolvedValue({ rows: nRows(8) as never, nextCursor: null });
    await getFeaturedProducts();
    expect(listProductsMock).toHaveBeenCalledTimes(1);
    const arg = listProductsMock.mock.calls[0][0];
    expect(arg.limit).toBe(8);
    expect(arg.sort).toBe("created_at");
    expect(arg.dir).toBe("desc");
    expect(arg.cursor).toBeNull(); // no paging on the homepage shelf
  });

  it("0 results → empty shelf; no fabricated cards", async () => {
    listProductsMock.mockResolvedValue({ rows: [] as never, nextCursor: null });
    const cards = await getFeaturedProducts();
    expect(cards).toHaveLength(0);
  });

  it("1 result → exactly 1 card (no filler)", async () => {
    listProductsMock.mockResolvedValue({ rows: nRows(1) as never, nextCursor: null });
    const cards = await getFeaturedProducts();
    expect(cards).toHaveLength(1);
    expect(new Set(cards.map((c) => c.id)).size).toBe(1);
  });

  it("8 results → exactly 8 unique cards, same order as the source", async () => {
    const rows = nRows(8);
    listProductsMock.mockResolvedValue({ rows: rows as never, nextCursor: null });
    const cards = await getFeaturedProducts();
    expect(cards).toHaveLength(8);
    expect(cards.map((c) => c.id)).toEqual(rows.map((r) => r.id));
  });

  it("defensive: >8 rows from the caller → 1:1 mapping, zero duplication, no invention", async () => {
    const rows = nRows(11);
    listProductsMock.mockResolvedValue({ rows: rows as never, nextCursor: null });
    const cards = await getFeaturedProducts();
    expect(cards).toHaveLength(11); // 1:1 with what the source sent
    expect(new Set(cards.map((c) => c.id)).size).toBe(11); // every id unique
    expect(listVariantsByProductMock).toHaveBeenCalledTimes(11); // one enrichment per card, bounded set
  });

  it("PARTIAL: a failed per-card stock read inside the shelf degrades to unknown, never fails the shelf", async () => {
    const rows = nRows(3);
    listProductsMock.mockResolvedValue({ rows: rows as never, nextCursor: null });
    (getProductStockStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("stock read failed"));
    (productHasInventoryRows as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const cards = await getFeaturedProducts();
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.stock === "unknown")).toBe(true);
  });
});
