// Admin single coupon: detail / edit / hard-delete.
// Reads: coupons.view. Field-level writes: isActive flips need
// coupons.disable; all other fields need coupons.update (both when
// combined). Code + promotion link immutable (schema omits them — unknown
// keys 400). Delete relies on RESTRICT FKs (usages pin history → 409).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission, getCurrentAdmin } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { couponPatchSchema } from "@/lib/promotions/validation";
import { getCoupon } from "@/lib/promotions/queries";
import { deleteCoupon, patchCoupon } from "@/lib/promotions/writes";
import { toCoupon } from "@/lib/promotions/serialize";

async function requireWrite(body: Record<string, unknown>): Promise<NextResponse | { actorId: string }> {
  const keys = Object.keys(body);
  let actorId: string | null = null;
  if (keys.includes("isActive")) {
    const auth = await checkPermission("coupons.disable");
    if (auth.ok === false) {
      const r = fail(new ApiError(auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "Forbidden."));
      return NextResponse.json(r.body, { status: r.status });
    }
    actorId = auth.admin.user.id;
  }
  if (keys.some((k) => k !== "isActive")) {
    const auth = await checkPermission("coupons.update");
    if (auth.ok === false) {
      const r = fail(new ApiError(auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "Forbidden."));
      return NextResponse.json(r.body, { status: r.status });
    }
    actorId = auth.admin.user.id;
  }
  // Empty-body PATCH runs no permission check (frozen); the actor falls
  // back to the request-cached admin (audit pairing still applies).
  if (actorId === null) {
    actorId = (await getCurrentAdmin())?.user.id ?? "";
  }
  return { actorId };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("coupons.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid coupon id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getCoupon(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toCoupon(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid coupon id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = couponPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid coupon."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const gate = await requireWrite(body as Record<string, unknown>);
  if (gate instanceof NextResponse) return gate;
  try {
    const updated = await patchCoupon(id, {
      usageLimit: parsed.data.usageLimit,
      perCustomerLimit: parsed.data.perCustomerLimit,
      minimumOrderAmount: parsed.data.minimumOrderAmount,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      isActive: parsed.data.isActive ?? undefined,
    }, gate.actorId);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toCoupon(updated));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("coupons.disable");
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
    const r = fail(new ApiError("VALIDATION", "Invalid coupon id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const done = await deleteCoupon(id, auth.admin.user.id);
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ deleted: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
