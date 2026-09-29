// Admin catalog: brand list + create. Reads: products.view.
// Creates: products.create (taxonomy merchandising under product caps).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import {
  brandInputSchema,
  brandListQuerySchema,
  queryBool,
} from "@/lib/catalog/validation";
import { listBrands } from "@/lib/catalog/queries";
import { createBrand as insertBrand } from "@/lib/catalog/writes";
import { toBrand } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
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
    active: queryBool(q.active),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toBrand),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
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
  const parsed = brandInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid brand."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await insertBrand(parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Brand not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toBrand(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
