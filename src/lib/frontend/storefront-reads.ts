// FE-2 storefront reads (server-only: Prisma-backed, RSC-consumed, never imported by clients).
// Pattern per FP-13 §3: RSC → server-only lib → DB → render. All errors propagate (pages catch
// into Loading/Empty/Error states); nothing here fabricates rows, prices, or offers.

import "server-only";

import { getBrand, getCategory, getProduct, listBrands, listCategories, listProducts, listVariantsByProduct } from "@/lib/catalog/queries";
import { getInventory } from "@/lib/inventory/queries";
import { searchProducts } from "@/lib/catalog/search";
import { listImages } from "@/lib/catalog/media";
import { getProductStockStatus } from "@/lib/inventory/queries";
import {
  toBrand,
  toCategory,
  toProductListItem,
  toVariant,
  type BrandShape,
  type CategoryShape,
} from "@/lib/catalog/serialize";
import type { ListingQuery } from "./listing-params";

export interface HomeProductCard {
  id: string;
  name: string;
  slug: string;
  unit: string;
  /** First sellable variant price basis; null when no priced variant is exposed. */
  price: string | null;
  compareAt: string | null;
  stock: "in" | "oos" | "unknown";
  image: string | null;
  brandName: string | null;
}

const HOME_LIMIT = 12;
const FEATURED_LIMIT = 8;
const PAGE_LIMIT = 12;
const OPTION_LIMIT = 100;

export interface PagedCards {
  cards: HomeProductCard[];
  nextCursor: string | null;
}

/** All active categories (bounded single fetch for navigation/filter options). */
export async function getAllCategories(): Promise<CategoryShape[]> {
  const page = await listCategories({
    limit: OPTION_LIMIT,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    parent: undefined,
    active: null,
  });
  return page.rows.map(toCategory);
}

/** All active brands (bounded; backing the brand filter + /brands index). */
export async function getAllBrands(): Promise<BrandShape[]> {
  const page = await listBrands({
    limit: OPTION_LIMIT,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    active: null,
  });
  return page.rows.map(toBrand);
}

/** Top-level active categories (parent == null), name-ordered. */
export async function getHomeCategories(): Promise<CategoryShape[]> {
  const page = await listCategories({
    limit: HOME_LIMIT,
    cursor: null,
    sort: "name",
    dir: "asc",
    search: null,
    parent: "null",
    active: null,
  });
  return page.rows.map(toCategory);
}

/** Enrich list rows with the display facts cards need. Bounded: callers cap input rows. */
export async function enrichCards(
  rows: { id: string; name: string; slug: string; unit: string; brand: { name: string } | null }[],
): Promise<HomeProductCard[]> {
  return Promise.all(
    rows.map(async (row) => {
      const [variants, images, stock] = await Promise.all([
        listVariantsByProduct(row.id, false, 1, null),
        listImages(row.id),
        getProductStockStatus(row.id).catch(() => null),
      ]);
      const first = variants.rows[0] ? toVariant(variants.rows[0]) : null;
      const primary = images.find((im) => im.isPrimary) ?? images[0] ?? null;
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        unit: row.unit,
        price: first ? first.price : null,
        compareAt: first ? first.compareAtPrice : null,
        stock: stock === null ? "unknown" : stock.isInStock ? "in" : "oos",
        image: primary ? primary.url : null,
        brandName: row.brand ? row.brand.name : null,
      };
    }),
  );
}

/**
 * Featured section (honest definition): most recently created active products.
 * There is NO featured/popular feed in the backend — the neutral title "منتجات من المتجر"
 * is used and no bestseller/featured claim is ever made.
 */
export async function getFeaturedProducts(): Promise<HomeProductCard[]> {
  const page = await listProducts({
    limit: FEATURED_LIMIT,
    cursor: null,
    sort: "created_at",
    dir: "desc",
    search: null,
    categoryId: null,
    brandId: null,
    productType: null,
    active: null,
    minPrice: null,
    maxPrice: null,
    inStock: null,
  });
  return enrichCards(page.rows.map(toProductListItem));
}

/** Live search (contract: q 2..120, relevance/newest, keyset). Throws on invalid query. */
export async function searchCatalog(q: string): Promise<HomeProductCard[]> {
  const page = await searchCatalogPaged(q, {
    sort: "relevance",
    dir: "desc",
    type: null,
    inStock: null,
    minPrice: null,
    maxPrice: null,
    brandId: null,
    categoryId: null,
    q: null,
  });
  return page.cards;
}

/** Paged search honoring filters/sort/cursor. nextCursor null = end (never page numbers). */
export async function searchCatalogPaged(q: string, query: ListingQuery, cursor: string | null = null): Promise<PagedCards> {
  const trimmed = q.trim();
  if (trimmed.length < 2 || trimmed.length > 120) {
    throw new Error("INVALID_QUERY");
  }
  const page = await searchProducts(trimmed, {
    limit: PAGE_LIMIT,
    cursor,
    sort: query.sort === "newest" ? "newest" : "relevance",
    categoryId: query.categoryId,
    brandId: query.brandId,
    productType: query.type,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock,
    includeInactive: false,
  });
  const cards = await enrichCards(
    page.rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, unit: r.unit, brand: r.brand })),
  );
  return { cards, nextCursor: page.nextCursor };
}

/** Active category by id, or null (callers render not-found). */
export async function getCategoryById(id: string): Promise<CategoryShape | null> {
  const row = await getCategory(id, false);
  return row ? toCategory(row) : null;
}

/** Active brand by id, or null. */
export async function getBrandById(id: string): Promise<BrandShape | null> {
  const row = await getBrand(id, false);
  return row ? toBrand(row) : null;
}

/** Paged category listing (server expands the subtree — see expandCategorySubtree). */
export async function listCategoryProducts(
  categoryId: string,
  query: ListingQuery,
  cursor: string | null = null,
): Promise<PagedCards> {
  const page = await listProducts({
    limit: PAGE_LIMIT,
    cursor,
    sort: query.sort === "name" ? "name" : "created_at",
    dir: query.dir,
    search: null,
    categoryId,
    brandId: query.brandId,
    productType: query.type,
    active: null,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock,
  });
  const cards = await enrichCards(page.rows.map(toProductListItem));
  return { cards, nextCursor: page.nextCursor };
}

/** Paged brand listing. */
export async function listBrandProducts(
  brandId: string,
  query: ListingQuery,
  cursor: string | null = null,
): Promise<PagedCards> {
  const page = await listProducts({
    limit: PAGE_LIMIT,
    cursor,
    sort: query.sort === "name" ? "name" : "created_at",
    dir: query.dir,
    search: null,
    categoryId: query.categoryId,
    brandId,
    productType: query.type,
    active: null,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock,
  });
  const cards = await enrichCards(page.rows.map(toProductListItem));
  return { cards, nextCursor: page.nextCursor };
}

export interface ProductPageVariant {
  id: string;
  name: string;
  sizeValue: string | null;
  sizeUnit: string | null;
  price: string;
  compareAt: string | null;
  stock: "in" | "oos" | "unknown";
}

export interface ProductPageData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brandName: string | null;
  categoryName: string;
  productType: "PIECE" | "WEIGHT";
  saleStepGrams: number | null;
  gallery: { url: string; alt: string | null }[];
  variants: ProductPageVariant[];
}

/**
 * Full PDP dataset (active product only; null when missing/inactive).
 * Variants: active-only with live price + per-variant stock read (bounded).
 * No promo evaluation here — compareAt is a reference, never an offer proof.
 */
export async function getProductPage(id: string): Promise<ProductPageData | null> {
  const row = await getProduct(id, false);
  if (!row) return null;
  const [detailVariants, images] = await Promise.all([
    listVariantsByProduct(row.id, false, 50, null),
    listImages(row.id),
  ]);
  const variants = await Promise.all(
    detailVariants.rows.map(async (v) => {
      const shape = toVariant(v);
      const inv = await getInventory(v.id).catch(() => null);
      const available = inv?.availableQuantity === null || inv?.availableQuantity === undefined
        ? Number.NaN
        : Number(inv.availableQuantity.toString());
      return {
        id: shape.id,
        name: shape.name,
        sizeValue: shape.sizeValue,
        sizeUnit: shape.sizeUnit,
        price: shape.price,
        compareAt: shape.compareAtPrice,
        stock: Number.isNaN(available) ? ("unknown" as const) : available > 0 ? ("in" as const) : ("oos" as const),
      };
    }),
  );
  const primary = images.find((im) => im.isPrimary) ?? images[0] ?? null;
  const ordered = primary ? [primary, ...images.filter((im) => im.id !== primary.id)] : images;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brandName: row.brand ? row.brand.name : null,
    categoryName: row.category.name,
    productType: row.productType as "PIECE" | "WEIGHT",
    saleStepGrams: row.saleStepGrams,
    gallery: ordered
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
      .map((im) => ({ url: im.url, alt: im.altText })),
    variants,
  };
}
