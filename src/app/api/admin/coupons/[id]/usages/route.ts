// Admin coupon usages: usage ledger for one coupon (read-only reporting;
// reads never bump counters — bumps happen only inside the checkout tx).
// Reads: coupons.view. No audit (read path).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema, paginationSchema } from "@/lib/api/validation";
import { getCoupon, listCouponUsages } from "@/lib/promotions/queries";
import { toUsage } from "@/lib/promotions/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("coupons.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid coupon id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = paginationSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const coupon = await getCoupon(id);
  if (!coupon) {
    const r = fail(new ApiError("NOT_FOUND", "Coupon not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listCouponUsages(id, {
    limit: q.limit,
    cursor: q.cursor ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((u) => toUsage(u)),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
