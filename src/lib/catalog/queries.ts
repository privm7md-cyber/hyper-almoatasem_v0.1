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
import { Prisma } from "@prisma/client";
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
      SELECT id FROM categories
        WHERE id = ${rootId}::uuid AND is_active AND deleted_at IS NULL
      UNION ALL
      SELECT c.id FROM categories c JOIN sub s ON c.parent_id = s.id
        WHERE c.is_active AND c.deleted_at IS NULL
    )
    SELECT id::text AS id FROM sub`;
  return rows.map((r) => r.id);
}

async function productListingWhere(filter: ProductListFilter): Promise<Prisma.ProductWhereInput> {
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
  return {
    ...(filter.active === null || filter.active === undefined
      ? { isActive: true, deletedAt: null }
      : filter.active
        ? { isActive: true }
        : { isActive: false }),
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
    ...(categoryIds === null ? {} : { categoryId: { in: categoryIds } }),
    ...(filter.brandId ? { brandId: filter.brandId } : {}),
    ...(filter.productType ? { productType: filter.productType } : {}),
    // Keep the price gate independent: the stock `variants` predicate below
    // must not overwrite it when both filters are supplied.
    ...(priceWindow !== null
      ? { AND: [{ variants: { some: { ...sellableVariant, price: priceWindow } } }] }
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
  };
}

/** Actual matching total with the same subtree/visibility/variant gates as the page. */
export async function countProducts(filter: ProductListFilter): Promise<number> {
  return prisma.product.count({ where: await productListingWhere(filter) });
}

export async function listProducts(filter: ProductListFilter) {
  const cursor = decodeCursor(filter.cursor);
  const keyset = filter.sort === "name" ? pageWhereName(cursor, filter.dir) : pageWhereCreatedAt(cursor, filter.dir);
  const where: Prisma.ProductWhereInput = { ...await productListingWhere(filter), ...keyset };
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

/* ------------------------------------------------------- admin catalogue reads */

/**
 * Admin product list.
 *
 * The storefront list is not enough for the operator: it searches one name
 * field only and hides inactive rows. The admin list therefore reads the
 * catalogue directly with the filters the panel actually offers — name, slug
 * or barcode; sell type; unit; category; brand; storefront visibility.
 *
 * Pagination is a raw-id keyset over a deterministic order
 * (`createdAt DESC, id ASC`). The page fetches LIMIT + 1 rows and mints the
 * next cursor from the LAST DISPLAYED row — the extra row is the probe for
 * "there is a next page", never the anchor itself, otherwise one product per
 * page would be skipped.
 */
export interface AdminProductFilter {
  limit: number;
  /** Id of the last displayed row — the keyset anchor for the next page. */
  cursor: string | null;
  /** Matches the product name, its link id, or any barcode of its shapes. */
  search: string | null;
  categoryId: string | null;
  brandId: string | null;
  productType: "PIECE" | "WEIGHT" | null;
  unit: string | null;
  /** Legacy visibility filter, applied only when state is absent. */
  isActive: boolean | null;
  /** Absent/null = nonarchived products, regardless of visibility. */
  state?: "displayed" | "hidden" | "archived" | null;
  /** Fetch the cheapest sellable price — only when the account may see prices. */
  withPrices: boolean;
  /** Read generated availability only when the account holds inventory.view. */
  withInventory?: boolean;
}

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  productType: string;
  unit: string;
  saleStepGrams: number | null;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string };
  brand: { id: string; name: string } | null;
  /** Cheapest active shape price; null when unavailable or not requested. */
  minPrice: string | null;
  /** Only the aggregate crosses the presentation boundary, never quantities. */
  stock: "in" | "oos" | "unknown";
}

/** The cheapest price of a set of shapes, compared as exact decimals. */
function cheapestPrice(prices: Array<{ price: Prisma.Decimal }>): string | null {
  let min: Prisma.Decimal | null = null;
  for (const row of prices) {
    if (min === null || row.price.lt(min)) min = row.price;
  }
  return min === null ? null : min.toString();
}

export async function listProductsForAdmin(
  filter: AdminProductFilter,
): Promise<{ rows: AdminProductRow[]; nextCursor: string | null; invalidCursor: boolean }> {
  const invalidPage = { rows: [], nextCursor: null, invalidCursor: true };
  // Raw-id admin cursors are not the storefront's opaque cursors. Validate
  // before Prisma sees a UUID, then check membership in these exact filters.
  if (filter.cursor !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filter.cursor)) {
    return invalidPage;
  }
  const filters: Prisma.ProductWhereInput = {
    deletedAt: filter.state === "archived" ? { not: null } : null,
    ...(filter.state === "archived"
      ? {}
      : filter.state === "displayed" || filter.state === "hidden"
        ? { isActive: filter.state === "displayed" }
        : filter.isActive === null ? {} : { isActive: filter.isActive }),
    ...(filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: "insensitive" } },
            { slug: { contains: filter.search, mode: "insensitive" } },
            { variants: { some: { codes: { some: { code: { contains: filter.search } } } } } },
          ],
        }
      : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.brandId ? { brandId: filter.brandId } : {}),
    ...(filter.productType ? { productType: filter.productType } : {}),
    ...(filter.unit ? { unit: filter.unit } : {}),
  };

  // The cursor is the id of the last displayed row; its sort key is read
  // back so the next page starts exactly after it (no skip, no repeat).
  let keyset: Prisma.ProductWhereInput = {};
  if (filter.cursor) {
    const anchor = await prisma.product.findFirst({
      where: { AND: [filters, { id: filter.cursor }] },
      select: { createdAt: true },
    });
    if (!anchor) return invalidPage;
    keyset = {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { gt: filter.cursor } },
      ],
    };
  }

  const rows: Array<Omit<AdminProductRow, "minPrice" | "stock"> & {
    variants?: Array<{
      price?: Prisma.Decimal;
      inventory?: { availableQuantity: Prisma.Decimal | null } | null;
    }>;
  }> = await prisma.product.findMany({
    where: { AND: [filters, keyset] },
    select: {
      id: true,
      name: true,
      slug: true,
      productType: true,
      unit: true,
      saleStepGrams: true,
      isActive: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      ...(filter.withPrices || filter.withInventory ? {
        variants: {
          where: { isActive: true, deletedAt: null },
          select: {
            ...(filter.withPrices ? { price: true } : {}),
            ...(filter.withInventory ? { inventory: { select: { availableQuantity: true } } } : {}),
          },
        },
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: filter.limit + 1,
  });

  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => {
      const variants = filter.withPrices || filter.withInventory ? row.variants ?? [] : [];
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        productType: row.productType,
        unit: row.unit,
        saleStepGrams: row.saleStepGrams,
        isActive: row.isActive,
        deletedAt: row.deletedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        category: { id: row.category.id, name: row.category.name },
        brand: row.brand ? { id: row.brand.id, name: row.brand.name } : null,
        minPrice: filter.withPrices
          ? cheapestPrice(variants.flatMap((variant) => variant.price != null ? [{ price: variant.price }] : []))
          : null,
        stock: !filter.withInventory
          ? "unknown"
          : variants.some((variant) => variant.inventory?.availableQuantity?.gt(0))
            ? "in"
            // Partial inventory coverage cannot prove unavailability.
            : variants.length > 0 && variants.every((variant) => {
                const available = variant.inventory?.availableQuantity;
                return available != null && available.lte(0);
              })
              ? "oos"
              : "unknown",
      };
    }),
    nextCursor: rows.length > filter.limit && last ? last.id : null,
    invalidCursor: false,
  };
}

/** Shared shape for the taxonomy lists (categories and brands). */
export interface AdminTaxonomyFilter {
  limit: number;
  /** Id of the last displayed row — the keyset anchor for the next page. */
  cursor: string | null;
  search: string | null;
  /** null = كل الحالات، true = المعروضة بس، false = المخفية بس. */
  isActive: boolean | null;
  /** Show the soft-deleted rows too (they stay in the table, clearly marked). */
  includeDeleted: boolean;
}

export interface AdminCategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  productCount: number;
}

export interface AdminBrandRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  deletedAt: Date | null;
  productCount: number;
}

export async function listCategoriesForAdmin(
  filter: AdminTaxonomyFilter,
): Promise<{ rows: AdminCategoryRow[]; nextCursor: string | null }> {
  const filters: Prisma.CategoryWhereInput = {
    ...(filter.isActive === null ? {} : { isActive: filter.isActive }),
    ...(filter.includeDeleted ? {} : { deletedAt: null }),
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
  };

  let keyset: Prisma.CategoryWhereInput = {};
  if (filter.cursor) {
    const anchor = await prisma.category.findUnique({
      where: { id: filter.cursor },
      select: { name: true },
    });
    if (!anchor) return { rows: [], nextCursor: null };
    keyset = {
      OR: [{ name: { gt: anchor.name } }, { name: anchor.name, id: { gt: filter.cursor } }],
    };
  }

  const rows = await prisma.category.findMany({
    where: { AND: [filters, keyset] },
    include: {
      parent: { select: { id: true, name: true } },
      _count: {
        select: { products: { where: { deletedAt: null } } },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: filter.limit + 1,
  });

  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId,
      parentName: row.parent?.name ?? null,
      isActive: row.isActive,
      deletedAt: row.deletedAt,
      productCount: row._count.products,
    })),
    nextCursor: rows.length > filter.limit && last ? last.id : null,
  };
}

export async function listBrandsForAdmin(
  filter: AdminTaxonomyFilter,
): Promise<{ rows: AdminBrandRow[]; nextCursor: string | null }> {
  const filters: Prisma.BrandWhereInput = {
    ...(filter.isActive === null ? {} : { isActive: filter.isActive }),
    ...(filter.includeDeleted ? {} : { deletedAt: null }),
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
  };

  let keyset: Prisma.BrandWhereInput = {};
  if (filter.cursor) {
    const anchor = await prisma.brand.findUnique({
      where: { id: filter.cursor },
      select: { name: true },
    });
    if (!anchor) return { rows: [], nextCursor: null };
    keyset = {
      OR: [{ name: { gt: anchor.name } }, { name: anchor.name, id: { gt: filter.cursor } }],
    };
  }

  const rows = await prisma.brand.findMany({
    where: { AND: [filters, keyset] },
    include: {
      _count: {
        select: { products: { where: { deletedAt: null } } },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: filter.limit + 1,
  });

  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      isActive: row.isActive,
      deletedAt: row.deletedAt,
      productCount: row._count.products,
    })),
    nextCursor: rows.length > filter.limit && last ? last.id : null,
  };
}

/** The shapes of a product with their codes — the detail screen reads both. */
export async function listVariantsWithCodes(productId: string) {
  return prisma.productVariant.findMany({
    where: { productId, deletedAt: null },
    include: {
      codes: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export function getProduct(id: string, includeInactive: boolean) {
  return prisma.product.findFirst({
    where: { id, ...(includeInactive ? {} : { isActive: true, deletedAt: null }) },
    include: {
      // parentId is additive: lets the PDP breadcrumb link the product's real
      // category chain (parent → category) without a second round-trip.
      category: { select: { id: true, name: true, slug: true, parentId: true } },
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

/**
 * Batch-fetch the first active variant (name ASC, id ASC) for a bounded list
 * of product IDs in ONE query (BUG-09 N+1 remediation).
 */
export async function listFirstVariantsForProducts(
  productIds: string[],
  includeInactive = false,
) {
  if (productIds.length === 0) {
    return new Map<string, Awaited<ReturnType<typeof prisma.productVariant.findMany>>[number]>();
  }
  const rows = await prisma.productVariant.findMany({
    where: {
      productId: { in: productIds },
      ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
    },
    orderBy: pageOrder("name", "asc") as Prisma.ProductVariantOrderByWithRelationInput[],
  });
  const firstByProduct = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!firstByProduct.has(row.productId)) {
      firstByProduct.set(row.productId, row);
    }
  }
  return firstByProduct;
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
