// Public storefront: single product with taxonomy (active rows only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getProduct } from "@/lib/catalog/queries";
import { toProductListItem } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getProduct(id, false);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Product not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toProductListItem(row));
  return NextResponse.json(r.body, { status: r.status });
}

