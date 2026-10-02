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
  try {
    const { rows, nextCursor } = await listCategories({
      limit: q.limit,
      cursor: q.cursor ?? null,
      sort: q.sort,
      dir: q.dir,
      search: q.search ?? null,
      parent: q.parent ?? undefined,
      active: null,
    });
    const r = ok(
      rows.map(toCategory),
      { limit: q.limit, nextCursor },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

