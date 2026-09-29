// Public storefront: product list (active rows only, prices included —
// storefront display necessity; admin price governance stays behind RBAC).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { productListQuerySchema} from "@/lib/catalog/validation";
import { listProducts } from "@/lib/catalog/queries";
import { toProductListItem } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const parsed = productListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listProducts({
    limit: q.limit,
    cursor: q.cursor ?? null,
    sort: q.sort,
    dir: q.dir,
    search: q.search ?? null,
    categoryId: q.category ?? null,
    brandId: q.brand ?? null,
    productType: q.type ?? null,
    active: null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toProductListItem),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

