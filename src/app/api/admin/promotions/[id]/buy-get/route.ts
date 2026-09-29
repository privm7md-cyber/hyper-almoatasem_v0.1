// Admin BXGY params: 1:1 upsert (BUY_X_GET_Y promos only).
// Permission: promotions.update. Referenced promos reject (422, A21).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { buyGetInputSchema } from "@/lib/promotions/validation";
import { putBuyGet } from "@/lib/promotions/writes";
import { toBuyGet } from "@/lib/promotions/serialize";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("promotions.update");
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
    const r = fail(new ApiError("VALIDATION", "Invalid promotion id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = buyGetInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid buy-get rules."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await putBuyGet(id, {
      buyQuantity: parsed.data.buyQuantity,
      getQuantity: parsed.data.getQuantity,
      discountPercent: parsed.data.discountPercent,
      freeVariantId: parsed.data.freeVariantId ?? null,
    }, auth.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toBuyGet(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
