// BA-2 catalog read domain (Prisma queries only, no writes) + BA-B2 keyset.
//
// Every read states its visibility contract explicitly: storefront reads
// force active-only rows (is_active AND deleted_at IS NULL); admin reads
// take an explicit active filter. Sorting is stable (requested field +
// direction-matched id tiebreak); pagination is exact keyset over
// (sort-field, id) via opaque server-minted cursors (api/pagination.ts) —
// no duplicates, no skips under static data. Availability/price filters
// use live relations (variants → inventory GENERATED available).
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  decodeCursor,
  encodeCursor,
  pageOrder,
  pageWhereCreatedAt,
  pageWhereName,
  type PageDir,
  type PageSort,
} from "@/lib/api/pagination";

export interface ListParams {
  limit: number;
  /** Opaque keyset cursor (server-minted); malformed → 400 VALIDATION. */
  cursor: string | null;
  sort: PageSort;
  dir: PageDir;
}

export interface Page<T> {
  rows: T[];
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: string | null;
}

const ACTIVE_ONLY: Prisma.CategoryWhereInput = { isActive: true, deletedAt: null };

/** Slice take+1 rows to a page + mint the next cursor from the last kept row. */
function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortValue: (row: T) => string,
): Page<T> {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: encodeCursor(sortValue(last), last.id) };
}

export async function listCategories(params: ListParams & { search: string | null; parent: string | null | undefined; active: boolean | null }) {
  const cursor = decodeCursor(params.cursor);
  const keyset = params.sort === "name" ? pageWhereName(cursor, params.dir) : pageWhereCreatedAt(cursor, params.dir);
  const where: Prisma.CategoryWhereInput = {
    ...(params.active === null || params.active === undefined ? ACTIVE_ONLY : params.active ? { isActive: true } : { isActive: false }),
    ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    ...(params.parent === undefined || params.parent === null
      ? {}
      : params.parent === "null"
        ? { parentId: null }
        : { parentId: params.parent }),
    ...keyset,
  };
  const rows = await prisma.category.findMany({
    where,
    orderBy: pageOrder(params.sort, params.dir) as Prisma.CategoryOrderByWithRelationInput[],
    take: params.limit + 1,
  });
  return toPage(rows, params.limit, (r) =>
    params.sort === "name" ? r.name : r.createdAt.toISOString(),
  );
}

export function getCategory(id: string, includeInactive: boolean) {
  return prisma.category.findFirst({
    where: { id, ...(includeInactive ? {} : ACTIVE_ONLY) },
  });
}

export async function listBrands(params: ListParams & { search: string | null; active: boolean | null }) {
  const cursor = decodeCursor(params.cursor);
  const keyset = params.sort === "name" ? pageWhereName(cursor, params.dir) : pageWhereCreatedAt(cursor, params.dir);
  const where: Prisma.BrandWhereInput = {
    ...(params.active === null || params.active === undefined ? { isActive: true, deletedAt: null } : params.active ? { isActive: true } : { isActive: false }),
    ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    ...keyset,
  };
  const rows = await prisma.brand.findMany({
    where,
    orderBy: pageOrder(params.sort, params.dir) as Prisma.BrandOrderByWithRelationInput[],
    take: params.limit + 1,
  });
  return toPage(rows, params.limit, (r) =>
    params.sort === "name" ? r.name : r.createdAt.toISOString(),
  );
}

export function getBrand(id: string, includeInactive: boolean) {
  return prisma.brand.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
  });
}

export type ProductListFilter = ListParams & {
  search: string | null;
  categoryId: string | null;
  brandId: string | null;
  productType: "PIECE" | "WEIGHT" | null;
  active: boolean | null;
  /** Price window applied to sellable variant prices (any-match). */
  minPrice: string | null;
  maxPrice: string | null;
  /** Stock gate: true → only products with a sellable in-stock variant. */
  inStock: boolean | null;
};

/**
 * Expand a category to itself + all descendants (single recursive CTE).
 * Subtree filtering keeps storefront semantics ("browse this department")
 * without N+1 queries. Unknown/deleted roots yield [] (no rows match).
 */
export async function expandCategorySubtree(rootId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE sub AS (
      SELECT id FROM categories WHERE id = ${rootId}::uuid
      UNION ALL
      SELECT c.id FROM categories c JOIN sub s ON c.parent_id = s.id
    )
    SELECT id::text AS id FROM sub`;
  return rows.map((r) => r.id);
}

export async function listProducts(filter: ProductListFilter) {
  const cursor = decodeCursor(filter.cursor);
  const keyset = filter.sort === "name" ? pageWhereName(cursor, filter.dir) : pageWhereCreatedAt(cursor, filter.dir);
  const categoryIds =
    filter.categoryId === null || filter.categoryId === undefined
      ? null
      : await expandCategorySubtree(filter.categoryId);
  // Sellable-variant scope shared by price + stock filters (active,
  // non-deleted variants; stock additionally requires available > 0 on the
  // GENERATED inventory column — live relations, never snapshots). Price
  // bounds constrain ONE variant (single `some`), never two different ones.
  const sellableVariant: Prisma.ProductVariantWhereInput = { isActive: true, deletedAt: null };
  const priceWindow =
    filter.minPrice === null || filter.minPrice === undefined
      ? filter.maxPrice === null || filter.maxPrice === undefined
        ? null
        : { lte: filter.maxPrice }
      : filter.maxPrice === null || filter.maxPrice === undefined
        ? { gte: filter.minPrice }
        : { gte: filter.minPrice, lte: filter.maxPrice };
  const where: Prisma.ProductWhereInput = {
    ...(filter.active === null || filter.active === undefined
      ? { isActive: true, deletedAt: null }
      : filter.active
        ? { isActive: true }
        : { isActive: false }),
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
    ...(categoryIds === null ? {} : { categoryId: { in: categoryIds } }),
    ...(filter.brandId ? { brandId: filter.brandId } : {}),
    ...(filter.productType ? { productType: filter.productType } : {}),
    ...(priceWindow !== null
      ? { variants: { some: { ...sellableVariant, price: priceWindow } } }
      : {}),
    // inStock=true: at least one sellable in-stock variant; false: NO
    // sellable variant is in stock (both directions are real filters —
    // never a silently-ignored parameter).
    ...(filter.inStock === true
      ? {
          variants: {
            some: {
              ...sellableVariant,
              inventory: { availableQuantity: { gt: 0 } },
            },
          },
        }
      : filter.inStock === false
        ? {
            NOT: {
              variants: {
                some: {
                  ...sellableVariant,
                  inventory: { availableQuantity: { gt: 0 } },
                },
              },
            },
          }
        : {}),
    ...keyset,
  };
  const rows = await prisma.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, slug: true } },
      brand: { select: { id: true, name: true, slug: true } },
    },
    orderBy: pageOrder(filter.sort, filter.dir) as Prisma.ProductOrderByWithRelationInput[],
    take: filter.limit + 1,
  });
  return toPage(rows, filter.limit, (r) =>
    filter.sort === "name" ? r.name : r.createdAt.toISOString(),
  );
}

export function getProduct(id: string, includeInactive: boolean) {
  return prisma.product.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      brand: { select: { id: true, name: true, slug: true } },
    },
  });
}

export async function listVariantsByProduct(productId: string, includeInactive: boolean, limit: number, cursor: string | null) {
  // Fixed name-asc order: keyset on (name, id) via the shared helper.
  const key = decodeCursor(cursor);
  const rows = await prisma.productVariant.findMany({
    where: {
      productId,
      ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
      ...pageWhereName(key, "asc"),
    },
    orderBy: pageOrder("name", "asc") as Prisma.ProductVariantOrderByWithRelationInput[],
    take: limit + 1,
  });
  return toPage(rows, limit, (r) => r.name);
}

export function getVariant(id: string, includeInactive: boolean) {
  return prisma.productVariant.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
  });
}

/** Cashier/scan path: global code UNIQUE resolves to exactly one variant.
 * Active-only for storefront; admin callers pass includeInactive. */
export function resolveProductCode(code: string, includeInactive: boolean) {
  return prisma.productCode.findFirst({
    where: {
      code,
      ...(includeInactive
        ? {}
        : { variant: { isActive: true, deletedAt: null, product: { isActive: true, deletedAt: null } } }),
    },
    include: {
      variant: {
        include: {
          product: {
            include: {
              category: { select: { id: true, name: true, slug: true } },
              brand: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
  });
}
