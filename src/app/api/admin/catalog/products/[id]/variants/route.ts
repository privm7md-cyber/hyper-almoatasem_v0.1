// Admin catalog: variant list scoped to a product + create.
// Reads: products.view. Creates: products.create.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { variantInputSchema, variantListQuerySchema } from "@/lib/catalog/validation";
import { getProduct, listVariantsByProduct } from "@/lib/catalog/queries";
import { createVariant as insertVariant } from "@/lib/catalog/writes";
import { toAdminVariant } from "@/lib/catalog/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const { id: productId } = await context.params;
  if (!uuidSchema.safeParse(productId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const product = await getProduct(productId, true);
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
    const { rows, nextCursor } = await listVariantsByProduct(productId, true, parsed.data.limit, parsed.data.cursor ?? null);
    const r = ok(
      rows.map(toAdminVariant),
      { limit: parsed.data.limit, nextCursor },
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.create");
  if ("denied" in gate) return gate.denied;
  const { id: productId } = await context.params;
  if (!uuidSchema.safeParse(productId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = variantInputSchema.omit({ productId: true }).safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await insertVariant({ ...parsed.data, productId }, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toAdminVariant(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const res = fail(error);
    return NextResponse.json(res.body, { status: res.status });
  }
}
