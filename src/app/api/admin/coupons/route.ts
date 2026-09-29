// Admin coupons: list + create (code access keys onto promotions).
// Reads: coupons.view. Creates: coupons.create. Codes normalize
// UPPER/trimmed (frozen case-insensitive-by-design); inner spaces → 400.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { couponInputSchema, couponListQuerySchema } from "@/lib/promotions/validation";
import { listCoupons, getCoupon } from "@/lib/promotions/queries";
import { createCoupon } from "@/lib/promotions/writes";
import { toCoupon } from "@/lib/promotions/serialize";

function queryBool(value: "true" | "false" | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === "true";
}

export async function GET(request: Request) {
  const denied = await denyUnless("coupons.view");
  if (denied) return denied;
  const parsed = couponListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listCoupons({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ? q.search.toUpperCase() : null,
    active: queryBool(q.active),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toCoupon),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(request: Request) {
  const auth = await checkPermission("coupons.create");
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
  const parsed = couponInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid coupon."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const createdRow = await createCoupon(parsed.data, auth.admin.user.id);
    const full = await getCoupon(createdRow.id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toCoupon(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
