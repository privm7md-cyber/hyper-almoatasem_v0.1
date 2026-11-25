// Admin coupons: list + create (code access keys onto promotions).
// Reads: coupons.view. Creates: coupons.create. Codes normalize
// UPPER/trimmed (frozen case-insensitive-by-design); inner spaces → 400.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { couponInputSchema, couponListQuerySchema } from "@/lib/promotions/validation";
import { listCouponsAdmin } from "@/lib/promotions/admin-coupon-queries";
import { createCoupon } from "@/lib/promotions/writes";
import { toAdminCoupon } from "@/lib/promotions/serialize";
import { COUPON_STATUS_VALUES, type CouponStatusValue } from "@/lib/promotions/coupon-status";

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
  // The status filter is SERVER-side: the status is computed in SQL (the same
  // expression the badge uses), never filtered in the browser.
  const rawStatus = (q as { status?: string }).status ?? null;
  const status: CouponStatusValue | null =
    rawStatus !== null && (COUPON_STATUS_VALUES as string[]).includes(rawStatus)
      ? (rawStatus as CouponStatusValue)
      : null;
  const rows = await listCouponsAdmin({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ? q.search.toUpperCase() : null,
    active: queryBool(q.active),
    status,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toAdminCoupon),
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
    const full = await listCouponsAdmin({
      limit: 1,
      cursor: null,
      search: createdRow.code,
      active: null,
      status: null,
    });
    const row = full.find((candidate) => candidate.id === createdRow.id) ?? null;
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toAdminCoupon(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
