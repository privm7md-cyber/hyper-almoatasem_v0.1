// Admin promotions: list + create.
// Reads: promotions.view. Creates: promotions.create. Activations stay
// DRAFT until targets (+BXGY rule) exist — enforced at status flip, so
// creation with status ACTIVE is rejected (configure first, then enable).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { promotionInputSchema, promotionListQuerySchema } from "@/lib/promotions/validation";
import { listPromotions, getPromotion } from "@/lib/promotions/queries";
import { createPromotion } from "@/lib/promotions/writes";
import { toPromotion } from "@/lib/promotions/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("promotions.view");
  if (denied) return denied;
  const parsed = promotionListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listPromotions({
    limit: q.limit,
    cursor: q.cursor ?? null,
    status: q.status ?? null,
    type: q.type ?? null,
    scope: q.scope ?? null,
    search: q.search ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      scope: p.scope,
      status: p.status,
      priority: p.priority,
      targetCount: p._count.targets,
      couponCount: p._count.coupons,
    })),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(request: Request) {
  const auth = await checkPermission("promotions.create");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = promotionInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid promotion."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const createdRow = await createPromotion(parsed.data, auth.admin.user.id);
    const full = await getPromotion(createdRow.id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Promotion not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toPromotion(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
