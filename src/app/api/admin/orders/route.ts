// Admin orders: list (status/customer/number/date filters, cursor pagination).
// Read permission: orders.view (frozen matrix key; inspection is the
// contract §11 admin surface for orders).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { adminOrderListQuerySchema } from "@/lib/orders/validation";
import { listOrdersAdmin } from "@/lib/orders/queries";
import { toOrderListItem } from "@/lib/orders/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("orders.view");
  if (denied) return denied;
  const parsed = adminOrderListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listOrdersAdmin({
    limit: q.limit,
    cursor: q.cursor ?? null,
    status: q.status ?? null,
    customerId: q.customerId ?? null,
    search: q.search ?? null,
    dateFrom: q.dateFrom ?? null,
    dateTo: q.dateTo ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((o) => toOrderListItem(o, o._count.items)),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
