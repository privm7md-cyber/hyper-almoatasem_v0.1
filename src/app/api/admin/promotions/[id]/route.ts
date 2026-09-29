// Admin single promotion: detail / edit / hard-delete.
// Reads: promotions.view. Field-level writes: status flips need
// promotions.disable; all other fields need promotions.update (both when
// combined). Delete relies on RESTRICT FKs (referenced history → 409).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission, getCurrentAdmin } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { promotionPatchSchema } from "@/lib/promotions/validation";
import { getPromotion } from "@/lib/promotions/queries";
import { deletePromotion, patchPromotion } from "@/lib/promotions/writes";
import { toPromotion } from "@/lib/promotions/serialize";

const STATUS_ONLY = new Set(["status"]);

async function requireWrite(body: Record<string, unknown>): Promise<NextResponse | { actorId: string }> {
  const keys = Object.keys(body);
  const wantsStatus = keys.some((k) => STATUS_ONLY.has(k));
  const wantsFields = keys.some((k) => !STATUS_ONLY.has(k));
  let actorId: string | null = null;
  if (wantsStatus) {
    const auth = await checkPermission("promotions.disable");
    if (auth.ok === false) {
      const r = fail(new ApiError(auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "Forbidden."));
      return NextResponse.json(r.body, { status: r.status });
    }
    actorId = auth.admin.user.id;
  }
  if (wantsFields) {
    const auth = await checkPermission("promotions.update");
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
  const denied = await denyUnless("promotions.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid promotion id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getPromotion(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toPromotion(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const parsed = promotionPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid promotion."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const gate = await requireWrite(body as Record<string, unknown>);
  if (gate instanceof NextResponse) return gate;
  try {
    const updated = await patchPromotion(id, {
      name: parsed.data.name ?? undefined,
      description: parsed.data.description,
      status: parsed.data.status ?? undefined,
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
      discountPercent: parsed.data.discountPercent,
      discountAmount: parsed.data.discountAmount,
      fixedPrice: parsed.data.fixedPrice,
      priority: parsed.data.priority ?? undefined,
      isStackable: parsed.data.isStackable ?? undefined,
      usageLimit: parsed.data.usageLimit,
    }, gate.actorId);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const full = await getPromotion(id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toPromotion(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("promotions.disable");
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
  try {
    const done = await deletePromotion(id, auth.admin.user.id);
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ deleted: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
