// Admin catalog: single product GET + PATCH. Type/unit/step are immutable
// after creation (weight-rule stability); PATCH covers name/slug/desc/
// taxonomy/isActive. Reads: products.view. Updates: products.update.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { productPatchSchema } from "@/lib/catalog/validation";
import { getProduct } from "@/lib/catalog/queries";
import { patchProduct } from "@/lib/catalog/writes";
import { toProductDetail, toProductListItem } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getProduct(id, true);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Product not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toProductDetail(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
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
  const parsed = productPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await patchProduct(id, parsed.data, gate.admin.user.id);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Product not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const row = await getProduct(id, true);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Product not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toProductListItem(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
