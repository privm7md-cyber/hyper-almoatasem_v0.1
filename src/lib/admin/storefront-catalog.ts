import "server-only";

import { requirePermission } from "@/lib/auth/rbac";
import { decodeCursor, pageWhereCreatedAt } from "@/lib/api/pagination";
import { countProducts, listProducts, type ProductListFilter } from "@/lib/catalog/queries";
import { countSearchProducts, decodeSearchCursor, searchProducts, type SearchFilter } from "@/lib/catalog/search";
import { toProductListItem } from "@/lib/catalog/serialize";
import { hasAnyInventoryRows } from "@/lib/inventory/queries";
import {
  enrichCards,
  getAllBrands,
  getHomeCategorySections,
  type PagedCards,
} from "@/lib/frontend/storefront-reads";
import {
  buildListingQuery,
  hasReversedPriceWindow,
  parseListingParams,
  parseSearchQuery,
  type ListingQuery,
} from "@/lib/frontend/listing-params";

export const ADMIN_STOREFRONT_PATH = "/admin/products/storefront";
const PAGE_LIMIT = 12;
type Params = Record<string, string | string[] | undefined>;

/** Every navigation link retains result-defining state and resets only the cursor. */
export function adminStorefrontHref(query: ListingQuery, cursor: string | null = null): string {
  const defaults = { sort: query.q ? "relevance" : "created_at" };
  const serialized = buildListingQuery(query, defaults, query.q ?? undefined);
  const params = new URLSearchParams(serialized);
  if (cursor) params.set("cursor", cursor);
  return `${ADMIN_STOREFRONT_PATH}${params.size ? `?${params}` : ""}`;
}

/** Read-only adapter; the guard runs before even consuming the parameter promise.
 * Uses the real storefront queries and card enrichment, not the admin cheapest-
 * variant list. No principal, raw DB row, cost, or purchase action leaves here.
 */
export async function readAdminStorefrontCatalog(searchParams: Promise<Params>) {
  const admin = await requirePermission("products.view");
  const canSeePrices = admin.permissions.includes("prices.view");
  const canSeeInventory = admin.permissions.includes("inventory.view");
  const canEdit = admin.permissions.includes("products.update");
  const raw = await searchParams;
  const rawQuery = typeof raw.q === "string" ? raw.q.trim() : "";
  const searching = rawQuery !== "" || Array.isArray(raw.q);
  const q = searching ? parseSearchQuery(raw) : null;
  const parsed = parseListingParams(raw, searching ? "search" : "listing");

  // Strip denied filters BEFORE validation or any read. Neither results, totals,
  // errors nor navigation may reveal prices/inventory through a crafted URL.
  const query: ListingQuery = {
    ...parsed,
    q,
    dir: searching ? "desc" : parsed.dir,
    minPrice: canSeePrices ? parsed.minPrice : null,
    maxPrice: canSeePrices ? parsed.maxPrice : null,
    inStock: canSeeInventory ? parsed.inStock : null,
  };
  const [sections, brands, availabilityKnown] = await Promise.all([
    getHomeCategorySections().catch(() => null),
    getAllBrands().catch(() => null),
    canSeeInventory ? hasAnyInventoryRows().catch(() => null) : null,
  ]);
  if (availabilityKnown !== true) query.inStock = null; // same public no-data gate

  let state: "ready" | "invalid-query" | "invalid-window" | "error" = "ready";
  if (searching && q === null) state = "invalid-query";
  else if (hasReversedPriceWindow(query)) state = "invalid-window";

  let cursor = typeof raw.cursor === "string" && raw.cursor !== "" ? raw.cursor : null;
  let invalidCursor = raw.cursor !== undefined && typeof raw.cursor !== "string";
  if (!invalidCursor && cursor) {
    try {
      if (searching) {
        const decoded = decodeSearchCursor(cursor);
        if (decoded) {
          const validTuple = query.sort === "newest"
            ? decoded.t === 0 && Number.isSafeInteger(decoded.s) && !Number.isNaN(new Date(decoded.s).getTime())
            : Number.isInteger(decoded.t) && decoded.t >= 0 && decoded.t <= 4 && Number.isFinite(decoded.s) && decoded.s >= 0 && decoded.s <= 1;
          if (!validTuple) throw new Error("Invalid cursor");
        }
      } else {
        const decoded = decodeCursor(cursor);
        if (query.sort === "created_at") pageWhereCreatedAt(decoded, query.dir);
      }
    } catch {
      invalidCursor = true;
    }
  }
  if (invalidCursor) cursor = null;

  const filters = {
    limit: PAGE_LIMIT,
    cursor,
    categoryId: query.categoryId,
    brandId: query.brandId,
    productType: query.type,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock,
  };
  const listingFilter: ProductListFilter = {
    ...filters, sort: query.sort === "name" ? "name" : "created_at", dir: query.dir, search: null, active: null,
  };
  const searchFilter: SearchFilter = {
    ...filters, sort: query.sort === "newest" ? "newest" : "relevance", includeInactive: false,
  };
  let page: PagedCards | null = null;
  let total: number | null = null;
  if (state === "ready") {
    // Count failure is isolated from product availability; a bounded page is
    // never substituted for an actual total. Counts do not use a cursor.
    const count = (searching
      ? countSearchProducts(q!, { ...searchFilter, cursor: null })
      : countProducts({ ...listingFilter, cursor: null })).catch(() => null);
    try {
      const result = searching ? await searchProducts(q!, searchFilter) : await listProducts(listingFilter);
      const rows = searching ? result.rows : (result.rows as Awaited<ReturnType<typeof listProducts>>["rows"]).map(toProductListItem);
      page = {
        cards: await enrichCards(rows, { withPrices: canSeePrices, withInventory: canSeeInventory }),
        nextCursor: result.nextCursor,
      };
    } catch {
      state = "error";
    }
    const actualTotal = await count;
    total = actualTotal !== null && Number.isSafeInteger(actualTotal) && actualTotal >= 0 ? actualTotal : null;
  }
  return {
    query, rawQuery, searching, state, page, total, sections, brands,
    canSeePrices, canSeeInventory, canEdit, availabilityKnown, invalidCursor,
    startHref: adminStorefrontHref(query),
    nextHref: page?.nextCursor ? adminStorefrontHref(query, page.nextCursor) : null,
  };
}
