// Admin single coupon: detail / edit / hard-delete.
// Reads: coupons.view. Field-level writes: isActive flips need
// coupons.disable; all other fields need coupons.update (both when
// combined). Code + promotion link immutable (schema omits them — unknown
// keys 400). Delete relies on RESTRICT FKs (usages pin history → 409).
//
// Phase-10 remediation (G05): a PATCH body with NO fields used to run NO
// permission check at all (the actor fell back to the cached session), so an
// admin holding none of the coupon keys could reach the domain write
// function and produce an audit row. The permission check is now
// UNCONDITIONAL, and an empty body is rejected with a validation error
// instead of reaching the domain layer.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { emptyPatchResponse, isEmptyPatchBody } from "@/lib/api/patch";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { couponPatchSchema } from "@/lib/promotions/validation";
import { getCoupon } from "@/lib/promotions/queries";
import { deleteCoupon, patchCoupon } from "@/lib/promotions/writes";
import { toCoupon } from "@/lib/promotions/serialize";

/**
 * The permission a coupon write needs:
 *   - `isActive` in the body -> coupons.disable
 *   - any other field        -> coupons.update
 *   - an EMPTY body          -> coupons.update (the general edit capability);
 *     the request is rejected with 400 right after, but the check still runs
 *     so an unauthorized caller can never reach the domain layer.
 */
async function requireWrite(body: Record<string, unknown>): Promise<NextResponse | { actorId: string }> {
  const keys = Object.keys(body);
  const required: string[] = [];
  if (keys.includes("isActive")) required.push("coupons.disable");
  if (keys.length === 0 || keys.some((k) => k !== "isActive")) required.push("coupons.update");
  let actorId: string | null = null;
  for (const permission of required) {
    const auth = await checkPermission(permission);
    if (auth.ok === false) {
      const r = fail(new ApiError(auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "Forbidden."));
      return NextResponse.json(r.body, { status: r.status });
    }
    actorId = auth.admin.user.id;
  }
  return { actorId: actorId ?? "" };
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
  // Authorization FIRST: an unauthorized caller must never learn whether the
  // body would have been acceptable (Phase-10 remediation, G05).
  const gate = await requireWrite(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {},
  );
  if (gate instanceof NextResponse) return gate;
  const parsed = couponPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid coupon."));
    return NextResponse.json(r.body, { status: r.status });
  }
  // An empty patch has no meaning in this contract: reject it explicitly
  // instead of writing a no-op row (and a no-op audit row).
  if (isEmptyPatchBody(body)) return emptyPatchResponse();
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
