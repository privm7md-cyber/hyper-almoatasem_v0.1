// Public storefront: brand list (active rows only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { brandListQuerySchema} from "@/lib/catalog/validation";
import { listBrands } from "@/lib/catalog/queries";
import { toBrand } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const parsed = brandListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listBrands({
    limit: q.limit,
    cursor: q.cursor ?? null,
    sort: q.sort,
    dir: q.dir,
    search: q.search ?? null,
    active: null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toBrand),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

