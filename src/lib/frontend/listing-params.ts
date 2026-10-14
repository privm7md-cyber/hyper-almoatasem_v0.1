// FE-3 listing URL state (pure, client-safe: no server imports).
// Rule: URL is the source of truth for result-defining state (filters/sort/query).
// Keyset cursors live OUTSIDE the URL (opaque append-chain; page-1 URL is the canonical
// shareable state — documented in the FE-3 report, never invented page numbers).

export type ListingSort = "name" | "created_at";
export type SearchSort = "relevance" | "newest";
export type SortDir = "asc" | "desc";

export interface ListingQuery {
  sort: string;
  dir: SortDir;
  type: "PIECE" | "WEIGHT" | null;
  inStock: boolean | null;
  minPrice: string | null;
  maxPrice: string | null;
  brandId: string | null;
  categoryId: string | null;
  q: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

function cleanSort(raw: string | null, allowed: string[], fallback: string): string {
  return raw !== null && allowed.includes(raw) ? raw : fallback;
}

function cleanDir(raw: string | null): SortDir {
  return raw === "asc" ? "asc" : "desc";
}

function cleanPrice(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  const v = raw.trim();
  return PRICE_RE.test(v) && Number(v) > 0 ? v : null;
}

function cleanId(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  return UUID_RE.test(raw.trim()) ? raw.trim() : null;
}

/** Parse + sanitize raw URL params. Malformed values fall back (never crash, never 500). */
export function parseListingParams(
  params: Record<string, string | string[] | undefined>,
  kind: "listing" | "search",
): ListingQuery {
  const one = (v: string | string[] | undefined): string | null =>
    typeof v === "string" ? v : null;
  const sort =
    kind === "search"
      ? cleanSort(one(params.sort), ["relevance", "newest"], "relevance")
      : cleanSort(one(params.sort), ["name", "created_at"], "created_at");
  const typeRaw = one(params.type);
  return {
    sort,
    dir: cleanDir(one(params.dir)),
    type: typeRaw === "PIECE" || typeRaw === "WEIGHT" ? typeRaw : null,
    inStock: one(params.inStock) === "true" ? true : one(params.inStock) === "false" ? false : null,
    minPrice: cleanPrice(one(params.minPrice)),
    maxPrice: cleanPrice(one(params.maxPrice)),
    brandId: cleanId(one(params.brand)),
    categoryId: cleanId(one(params.category)),
    q: null,
  };
}

/** Parse the search query text (contract: 2..120 chars). Returns null when absent/invalid. */
export function parseSearchQuery(params: Record<string, string | string[] | undefined>): string | null {
  const raw = params.q;
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  return q.length >= 2 && q.length <= 120 ? q : null;
}

/** Serialize a ListingQuery (+optional q) back to a query string. Defaults omitted. */
export function buildListingQuery(query: ListingQuery, defaults: { sort: string }, q?: string): string {
  const sp = new URLSearchParams();
  if (q !== undefined && q !== "") sp.set("q", q);
  if (query.sort !== defaults.sort) sp.set("sort", query.sort);
  if (query.dir !== "desc") sp.set("dir", query.dir);
  if (query.type !== null) sp.set("type", query.type);
  if (query.inStock !== null) sp.set("inStock", query.inStock ? "true" : "false");
  if (query.minPrice !== null) sp.set("minPrice", query.minPrice);
  if (query.maxPrice !== null) sp.set("maxPrice", query.maxPrice);
  if (query.brandId !== null) sp.set("brand", query.brandId);
  if (query.categoryId !== null) sp.set("category", query.categoryId);
  const s = sp.toString();
  return s === "" ? "" : `?${s}`;
}

export interface SortOption {
  key: string;
  sort: string;
  dir: SortDir;
  label: string;
}

export const LISTING_SORT_OPTIONS: SortOption[] = [
  { key: "created_at:desc", sort: "created_at", dir: "desc", label: "الأحدث" },
  { key: "created_at:asc", sort: "created_at", dir: "asc", label: "الأقدم" },
  { key: "name:asc", sort: "name", dir: "asc", label: "الاسم (أ→ي)" },
  { key: "name:desc", sort: "name", dir: "desc", label: "الاسم (ي→أ)" },
];

export function sortKeyFor(sort: string, dir: SortDir): string {
  return `${sort}:${dir}`;
}

export const SEARCH_SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "relevance", label: "الصلة" },
  { value: "newest", label: "الأحدث" },
];
