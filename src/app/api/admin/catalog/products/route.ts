// Admin catalog: product list (explicit active filter) + create.
// Reads: products.view. Creates: products.create. Weight shape validated
// against the frozen rule before insert (DB CHECK remains the enforcer).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import {
  productInputSchema,
  productListQuerySchema,
  queryBool,
} from "@/lib/catalog/validation";
import { listProducts } from "@/lib/catalog/queries";
import { getProduct } from "@/lib/catalog/queries";
import { createProduct as insertProduct } from "@/lib/catalog/writes";
import { toProductListItem } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
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
    active: queryBool(q.active),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toProductListItem),
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
  const parsed = productInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const createdRow = await insertProduct(parsed.data, gate.admin.user.id);
    const row = await getProduct(createdRow.id, true);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Product not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toProductListItem(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
