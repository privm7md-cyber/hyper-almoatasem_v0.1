// Public storefront: variants of one product (active rows only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { paginationSchema } from "@/lib/api/validation";
import { getProduct, listVariantsByProduct } from "@/lib/catalog/queries";
import { toVariant } from "@/lib/catalog/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const product = await getProduct(id, false);
  if (!product) {
    const r = fail(new ApiError("NOT_FOUND", "Product not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = paginationSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const rows = await listVariantsByProduct(id, false, parsed.data.limit, parsed.data.cursor ?? null);
  const page = rows.length > parsed.data.limit ? rows.slice(0, parsed.data.limit) : rows;
  const r = ok(
    page.map(toVariant),
    { limit: parsed.data.limit, nextCursor: rows.length > parsed.data.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

