// Admin catalog: single product GET + PATCH. Since GD-2/BL-02 (owner-approved
// 2026-11-01) the sale-usage fields (productType/unit/saleStepGrams) are
// patchable under the two-legal-states transition rule + If-Match concurrency
// token; PATCH also covers name/slug/desc/taxonomy/isActive. Reads:
// products.view. Updates: products.update.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { productPatchSchema } from "@/lib/catalog/validation";
import { getProduct } from "@/lib/catalog/queries";
import { patchProduct } from "@/lib/catalog/writes";
import { hardDeleteInputSchema, hardDeleteProduct } from "@/lib/catalog/hard-delete";
import { toProductDetail, toProductListItem } from "@/lib/catalog/serialize";
import { emptyPatchResponse, isEmptyPatchBody } from "@/lib/api/patch";

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
  // BL-02 (GD-2): the concurrency token is discoverable — ETag carries the
  // row's updatedAt so a PATCH can present it back as If-Match.
  const res = NextResponse.json(r.body, { status: r.status });
  res.headers.set("ETag", `"${row.updatedAt.toISOString()}"`);
  return res;
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
  // An empty patch changes nothing: reject it instead of writing a no-op row
  // and a misleading audit row (Phase-10 remediation, G05).
  if (isEmptyPatchBody(body)) return emptyPatchResponse();
  try {
    // BL-02 (GD-2): concurrency token — the If-Match header wins over the
    // body key when both arrive. Raw ISO (quotes tolerated, "*" = match-any).
    const ifMatch = request.headers.get("if-match");
    const expectedUpdatedAt =
      ifMatch !== null && ifMatch.trim() !== ""
        ? ifMatch.trim().replace(/^"|"$/g, "")
        : (parsed.data.expectedUpdatedAt ?? undefined);
    const updated = await patchProduct(id, { ...parsed.data, expectedUpdatedAt }, gate.admin.user.id);
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
    const res = NextResponse.json(r.body, { status: r.status });
    // BL-02: the post-write token is returned so the next PATCH can be
    // conditional without an extra read.
    res.headers.set("ETag", `"${row.updatedAt.toISOString()}"`);
    return res;
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

/**
 * ADM-OWNER G2 — the final delete, UNREFERENCED ONLY.
 *
 * Permission: products.delete (the delete capability, never products.update).
 * The rule is enforced on the server: a product with ANY protected reference
 * (orders, movements, promotions, price history, protected audit rows…) is
 * refused with an Arabic reason and the archive stays the safe path. The
 * reference check runs INSIDE the delete's own transaction, under the
 * catalogue lock the promotion writers also take.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.delete");
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
  const parsed = hardDeleteInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid hard delete request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const result = await hardDeleteProduct(id, parsed.data, gate.admin.user.id);
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
