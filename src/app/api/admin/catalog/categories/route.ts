// Admin catalog: category list (explicit active filter incl. inactive) + create.
// Reads: products.view. Creates: products.create (taxonomy has no dedicated
// keys in the frozen 31-key matrix; merchandising falls under product caps).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import {
  categoryInputSchema,
  categoryListQuerySchema,
  queryBool,
} from "@/lib/catalog/validation";
import { listCategories } from "@/lib/catalog/queries";
import { createCategory as insertCategory } from "@/lib/catalog/writes";
import { toCategory } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const parsed = categoryListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
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
      active: queryBool(q.active),
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

export async function POST(request: Request) {
  const gate = await adminOrDeny("products.create");
  if ("denied" in gate) return gate.denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = categoryInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid category."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await insertCategory(parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Category not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toCategory(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
