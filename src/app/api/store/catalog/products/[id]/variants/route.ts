// Public storefront: variants of one product (active rows only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { variantListQuerySchema } from "@/lib/catalog/validation";
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
  const parsed = variantListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const { rows, nextCursor } = await listVariantsByProduct(id, false, parsed.data.limit, parsed.data.cursor ?? null);
    const r = ok(
      rows.map(toVariant),
      { limit: parsed.data.limit, nextCursor },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

