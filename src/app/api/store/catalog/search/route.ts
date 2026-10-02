// Public storefront product search (BA-B3).
//
// Exact code lookup is pinned first (deterministic, never fuzzy-covered);
// text search runs database-side (pg_trgm + hyper_norm_ar ranking tiers,
// keyset pages). Empty queries answer 400 (never list-all). Out-of-stock
// products stay listed (availability is inventory's domain, not a search
// filter default). Requires the search migration objects (extension +
// function + indexes, db/future/search-trgm.sql, scratch-verified); without
// them the query fails LOUD (500, never silent wrong results).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { queryBool, searchQuerySchema } from "@/lib/catalog/validation";
import { searchProducts } from "@/lib/catalog/search";

export async function GET(request: Request) {
  const parsed = searchQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid search request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  if (
    q.minPrice !== null &&
    q.minPrice !== undefined &&
    q.maxPrice !== null &&
    q.maxPrice !== undefined &&
    Number(q.maxPrice) < Number(q.minPrice)
  ) {
    const r = fail(new ApiError("VALIDATION", "Invalid price window."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const page = await searchProducts(q.q, {
      limit: q.limit,
      cursor: q.cursor ?? null,
      sort: q.sort,
      categoryId: q.category ?? null,
      brandId: q.brand ?? null,
      productType: q.type ?? null,
      minPrice: q.minPrice ?? null,
      maxPrice: q.maxPrice ?? null,
      inStock: queryBool(q.inStock),
      includeInactive: false,
    });
    const r = ok(
      { query: q.q, results: page.rows },
      { limit: q.limit, nextCursor: page.nextCursor },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
