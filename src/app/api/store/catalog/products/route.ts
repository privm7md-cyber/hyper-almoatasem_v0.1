// Public storefront: product list (active rows only, prices included —
// storefront display necessity; admin price governance stays behind RBAC).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { productListQuerySchema, queryBool } from "@/lib/catalog/validation";
import { listProducts } from "@/lib/catalog/queries";
import { toProductListItem } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const parsed = productListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
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
    const { rows, nextCursor } = await listProducts({
      limit: q.limit,
      cursor: q.cursor ?? null,
      sort: q.sort,
      dir: q.dir,
      search: q.search ?? null,
      categoryId: q.category ?? null,
      brandId: q.brand ?? null,
      productType: q.type ?? null,
      active: null,
      minPrice: q.minPrice ?? null,
      maxPrice: q.maxPrice ?? null,
      inStock: queryBool(q.inStock),
    });
    const r = ok(
      rows.map(toProductListItem),
      { limit: q.limit, nextCursor },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

