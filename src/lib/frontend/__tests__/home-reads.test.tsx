// P05 unit tests (Phase 05 — homepage commercial content): serialization honesty
// for the homepage reads layer, WITHOUT a database (jsdom only).
//   • enrichCards: stock truth (unknown ≠ oos), image fallbacks, variant price wiring
//   • partial-failure isolation: a failed images/stock read must not fabricate state
//   • getHomeCategorySections: real-tree grouping, honest orphan omission
// All catalog/inventory/media/search modules are mocked; no fixture pretends to be
// real inventory. Assertions test the CONTRACT, not the live catalog.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

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
vi.mock("@/lib/catalog/media", () => ({
  listImages: vi.fn(),
}));
vi.mock("@/lib/catalog/search", () => ({
  searchProducts: vi.fn(),
}));

import {
  listCategories,
  listVariantsByProduct,
} from "@/lib/catalog/queries";
import { productHasInventoryRows, getProductStockStatus } from "@/lib/inventory/queries";
import { listImages } from "@/lib/catalog/media";
import { enrichCards, getHomeCategorySections } from "../storefront-reads";
import type { HomeProductCard } from "../storefront-reads";

const listVariantsByProductMock = vi.mocked(listVariantsByProduct);
const productHasInventoryRowsMock = vi.mocked(productHasInventoryRows);
const getProductStockStatusMock = vi.mocked(getProductStockStatus);
const listImagesMock = vi.mocked(listImages);
const listCategoriesMock = vi.mocked(listCategories);

const ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "منتج اختبار",
  slug: "منتج-اختبار",
  unit: "PIECE",
  productType: "PIECE",
  saleStepGrams: null,
  brand: { name: "دايو" },
};

const VARIANT = {
  id: "22222222-2222-2222-2222-222222222222",
  productId: ROW.id,
  name: "عبوة 125 جم",
  sizeValue: new Prisma.Decimal("125"),
  sizeUnit: "GRAM",
  price: new Prisma.Decimal("15.5"),
  compareAtPrice: null,
  costPrice: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  deletedAt: null,
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  listVariantsByProductMock.mockResolvedValue({ rows: [VARIANT], nextCursor: null });
  productHasInventoryRowsMock.mockResolvedValue(false);
  getProductStockStatusMock.mockResolvedValue(null);
  listImagesMock.mockResolvedValue([]);
});

describe("enrichCards (homepage shelf mapping)", () => {
  it("no inventory rows → stock is unknown (never oos)", async () => {
    productHasInventoryRowsMock.mockResolvedValue(false);
    getProductStockStatusMock.mockResolvedValue({ productId: ROW.id, sellableVariants: 1, inStockVariants: 0, isInStock: false });
    const [card] = await enrichCards([ROW] as never);
    expect(card.stock).toBe("unknown");
  });

  it("inventory rows + in-stock view → in", async () => {
    productHasInventoryRowsMock.mockResolvedValue(true);
    getProductStockStatusMock.mockResolvedValue({ productId: ROW.id, sellableVariants: 2, inStockVariants: 1, isInStock: true });
    const [card] = await enrichCards([ROW] as never);
    expect(card.stock).toBe("in");
  });

  it("inventory rows + out-of-stock view → oos", async () => {
    productHasInventoryRowsMock.mockResolvedValue(true);
    getProductStockStatusMock.mockResolvedValue({ productId: ROW.id, sellableVariants: 1, inStockVariants: 0, isInStock: false });
    const [card] = await enrichCards([ROW] as never);
    expect(card.stock).toBe("oos");
  });

  it("P05 partial-failure honesty: inventory rows exist but the stock read FAILED → unknown (never oosclaim)", async () => {
    productHasInventoryRowsMock.mockResolvedValue(true);
    getProductStockStatusMock.mockRejectedValue(new Error("stock view read failed"));
    const [card] = await enrichCards([ROW] as never);
    expect(card.stock).toBe("unknown");
  });

  it("no inventory rows + stock read failed → unknown", async () => {
    productHasInventoryRowsMock.mockResolvedValue(false);
    getProductStockStatusMock.mockRejectedValue(new Error("stock view read failed"));
    const [card] = await enrichCards([ROW] as never);
    expect(card.stock).toBe("unknown");
  });

  it("image: none → null; primary wins; non-primary is fallback-only", async () => {
    listImagesMock.mockResolvedValue([]);
    const [none] = await enrichCards([ROW] as never);
    expect(none.image).toBeNull();

    listImagesMock.mockResolvedValue([
      { productId: ROW.id, id: "a", url: "/shop/gallery-a.jpg", altText: null, mimeType: null, byteSize: null, width: null, height: null, sortOrder: 1, isPrimary: false, createdAt: new Date("2026-01-01T00:00:00Z") },
      { productId: ROW.id, id: "b", url: "/shop/gallery-b.jpg", altText: "alt", mimeType: null, byteSize: null, width: null, height: null, sortOrder: 0, isPrimary: true, createdAt: new Date("2026-01-01T00:00:00Z") },
    ]);
    const [withImage] = await enrichCards([ROW] as never);
    expect(withImage.image).toBe("/shop/gallery-b.jpg");
  });

  it("a failed images read degrades to no image and never fails the card", async () => {
    listImagesMock.mockRejectedValue(new Error("images read failed"));
    const [card] = await enrichCards([ROW] as never);
    expect(card.image).toBeNull();
  });

  it("variant wiring: price + compareAt + size pass through; no variant → price null", async () => {
    const [card] = await enrichCards([ROW] as never);
    expect(card.price).toBe("15.5");
    expect(card.sizeValue).toBe("125");
    expect(card.sizeUnit).toBe("GRAM");
    expect(card.compareAt).toBeNull();

    listVariantsByProductMock.mockResolvedValue({ rows: [], nextCursor: null });
    const [empty] = await enrichCards([ROW] as never);
    expect(empty.price).toBeNull();
    expect(empty.sizeValue).toBeNull();
  });
});

describe("getHomeCategorySections (real tree, no fabricated parents)", () => {
  const date = { createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z") };
  const mainA = { id: "m-a", name: "بقالة", slug: "baqala", description: null, image: null, parentId: null, isActive: true, sortOrder: 0, ...date };
  const mainB = { id: "m-b", name: "أطفال", slug: "kids", description: null, image: null, parentId: null, isActive: true, sortOrder: 0, ...date };
  const subB1 = { id: "s-b1", name: "حليب أطفال", slug: "baby-milk", description: null, image: null, parentId: "m-b", isActive: true, sortOrder: 0, ...date };
  const subA1 = { id: "s-a1", name: "أرز", slug: "rice", description: null, image: null, parentId: "m-a", isActive: true, sortOrder: 0, ...date };
  const orphan = { id: "orphan", name: "بلا أب", slug: "orphan", description: null, image: null, parentId: "m-missing", isActive: true, sortOrder: 0, ...date };

  it("groups subs under their real parents, sorts by name, omits orphans", async () => {
    listCategoriesMock.mockResolvedValue({ rows: [mainA, mainB, subA1, subB1, orphan] as never, nextCursor: null });
    const sections = await getHomeCategorySections();
    expect(sections.mains.map((m) => m.name)).toEqual(["أطفال", "بقالة"]);
    expect(sections.subs).toHaveLength(2);
    expect(sections.subs[0].parent.id).toBe("m-b"); // أطفال < بقالة
    expect(sections.subs[0].children.map((c) => c.id)).toEqual(["s-b1"]);
    expect(sections.subs[1].parent.id).toBe("m-a");
    expect(sections.subs.find((s) => s.parent.id === "m-missing")).toBeUndefined(); // orphan never faked
  });

  it("zero categories flows through as empty (page then shows the honest empty state)", async () => {
    listCategoriesMock.mockResolvedValue({ rows: [] as never, nextCursor: null });
    const sections = await getHomeCategorySections();
    expect(sections.mains).toHaveLength(0);
    expect(sections.subs).toHaveLength(0);
  });

  it("top-level failure propagates to the section boundary (independent section error)", async () => {
    listCategoriesMock.mockRejectedValue(new Error("catalog read failed"));
    await expect(getHomeCategorySections()).rejects.toThrow("catalog read failed");
  });
});

// Contract guard used by other suites: the shelf type keeps price as string|null
it("HomeProductCard price stays a string|null boundary, never a client-computed number", () => {
  const probe: HomeProductCard = {
    id: ROW.id, name: ROW.name, slug: ROW.slug, unit: ROW.unit,
    productType: "PIECE", saleStepGrams: null, sizeValue: null, sizeUnit: null,
    price: null, compareAt: null, stock: "unknown", image: null, brandName: null,
  };
  expect(probe.price).toBeNull();
});
