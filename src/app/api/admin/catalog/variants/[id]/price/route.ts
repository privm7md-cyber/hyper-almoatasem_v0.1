// Admin catalog: variant price change. Writes the new price AND the
// price-history row in ONE transaction (frozen convention — never one
// without the other). Permission: products.update (price governance).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { variantPriceInputSchema } from "@/lib/catalog/validation";
import { getVariant } from "@/lib/catalog/queries";
import { updateVariantPrice } from "@/lib/catalog/writes";
import { toAdminVariant } from "@/lib/catalog/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("products.update");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = variantPriceInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid price."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await updateVariantPrice(id, parsed.data.price, parsed.data.reason ?? null, auth.admin.user.id, auth.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const full = await getVariant(id, true);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toAdminVariant(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
