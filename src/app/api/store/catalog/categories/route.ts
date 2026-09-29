// Public storefront: category list (active rows only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { categoryListQuerySchema} from "@/lib/catalog/validation";
import { listCategories } from "@/lib/catalog/queries";
import { toCategory } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = categoryListQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listCategories({
    limit: q.limit,
    cursor: q.cursor ?? null,
    sort: q.sort,
    dir: q.dir,
    search: q.search ?? null,
    parent: q.parent ?? undefined,
    active: null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toCategory),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

