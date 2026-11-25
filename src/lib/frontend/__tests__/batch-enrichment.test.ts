import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const batchMocks = vi.hoisted(() => ({
  listFirstVariantsForProducts: vi.fn(),
  listPrimaryImagesForProducts: vi.fn(),
  getProductsStockBatch: vi.fn(),
  listVariantsByProduct: vi.fn(),
  listImages: vi.fn(),
  getProductStockStatus: vi.fn(),
  productHasInventoryRows: vi.fn(),
}));

vi.mock("@/lib/catalog/queries", () => ({
  getBrand: vi.fn(),
  getCategory: vi.fn(),
  getProduct: vi.fn(),
  listBrands: vi.fn(),
  listCategories: vi.fn(),
  listProducts: vi.fn(),
  listVariantsByProduct: batchMocks.listVariantsByProduct,
  listFirstVariantsForProducts: batchMocks.listFirstVariantsForProducts,
}));

vi.mock("@/lib/catalog/media", () => ({
  listImages: batchMocks.listImages,
  listPrimaryImagesForProducts: batchMocks.listPrimaryImagesForProducts,
}));

vi.mock("@/lib/inventory/queries", () => ({
  getInventory: vi.fn(),
  productHasInventoryRows: batchMocks.productHasInventoryRows,
  getProductStockStatus: batchMocks.getProductStockStatus,
  getProductsStockBatch: batchMocks.getProductsStockBatch,
}));

vi.mock("@/lib/catalog/search", () => ({
  searchProducts: vi.fn(),
}));

import { enrichCards } from "../storefront-reads";

describe("BUG-09 batch card enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches 12 product cards using a single batch call per domain instead of 12 N+1 loops", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `01800000-0000-7000-8000-0000000000${String(i + 10).padStart(2, "0")}`,
      name: `منتج ${i + 1}`,
      slug: `prod-${i + 1}`,
      unit: "PIECE",
      productType: "PIECE",
      saleStepGrams: null,
      brand: { name: "المعتصم" },
    }));

    const variantMap = new Map();
    const imageMap = new Map();
    const hasInventorySet = new Set<string>();
    const statusByProduct = new Map();

    for (const r of rows) {
      variantMap.set(r.id, {
        id: `v-${r.id}`,
        productId: r.id,
        name: "1 كجم",
        sku: null,
        sizeValue: null,
        sizeUnit: null,
        price: { toString: () => "55.00" },
        compareAtPrice: null,
        isActive: true,
        deletedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
      imageMap.set(r.id, {
        id: `img-${r.id}`,
        productId: r.id,
        url: `https://example.com/${r.slug}.jpg`,
        altText: r.name,
        mimeType: "image/jpeg",
        byteSize: 1024,
        width: 400,
        height: 300,
        sortOrder: 0,
        isPrimary: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      hasInventorySet.add(r.id);
      statusByProduct.set(r.id, {
        productId: r.id,
        sellableVariants: 1,
        knownSellableBalances: 1,
        inStockVariants: 1,
        isInStock: true,
      });
    }

    batchMocks.listFirstVariantsForProducts.mockResolvedValue(variantMap);
    batchMocks.listPrimaryImagesForProducts.mockResolvedValue(imageMap);
    batchMocks.getProductsStockBatch.mockResolvedValue({
      hasInventorySet,
      statusByProduct,
    });

    const cards = await enrichCards(rows);
    expect(cards).toHaveLength(12);
    expect(cards[0]).toMatchObject({
      name: "منتج 1",
      price: "55.00",
      stock: "in",
      image: "https://example.com/prod-1.jpg",
      brandName: "المعتصم",
    });

    // Proves N+1 is eliminated: each batch helper called ONCE for all 12 products,
    // and the single-row functions are called ZERO times!
    expect(batchMocks.listFirstVariantsForProducts).toHaveBeenCalledTimes(1);
    expect(batchMocks.listPrimaryImagesForProducts).toHaveBeenCalledTimes(1);
    expect(batchMocks.getProductsStockBatch).toHaveBeenCalledTimes(1);
    expect(batchMocks.listVariantsByProduct).not.toHaveBeenCalled();
    expect(batchMocks.listImages).not.toHaveBeenCalled();
    expect(batchMocks.getProductStockStatus).not.toHaveBeenCalled();
    expect(batchMocks.productHasInventoryRows).not.toHaveBeenCalled();
  });

  it.each([
    { withPrices: false, withInventory: false },
    { withPrices: true, withInventory: false },
    { withPrices: false, withInventory: true },
  ])("batch enrichment calls only permitted domains %j", async options => {
    const row = { id: "p1", name: "منتج", slug: "product", unit: "PIECE", productType: "PIECE", saleStepGrams: null, brand: null };
    batchMocks.listFirstVariantsForProducts.mockResolvedValue(new Map());
    batchMocks.listPrimaryImagesForProducts.mockResolvedValue(new Map());
    batchMocks.getProductsStockBatch.mockResolvedValue({ hasInventorySet: new Set(), statusByProduct: new Map() });
    const [card] = await enrichCards([row], options);
    expect(batchMocks.listFirstVariantsForProducts).toHaveBeenCalledTimes(options.withPrices ? 1 : 0);
    expect(batchMocks.getProductsStockBatch).toHaveBeenCalledTimes(options.withInventory ? 1 : 0);
    expect(batchMocks.listPrimaryImagesForProducts).toHaveBeenCalledWith([row.id]);
    expect(card).toMatchObject({ price: null, compareAt: null, sizeValue: null, sizeUnit: null, stock: "unknown" });
    expect(batchMocks.listVariantsByProduct).not.toHaveBeenCalled();
    expect(batchMocks.getProductStockStatus).not.toHaveBeenCalled();
  });
});
