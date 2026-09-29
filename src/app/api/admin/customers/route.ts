// Admin customers: list/search (explicit filters + bounded cursor).
// Read permission: customers.view (the frozen matrix holds no other
// customer key; writes reuse it per the documented BA-2-precedent mapping).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { adminCustomerListQuerySchema, queryBool } from "@/lib/customers/validation";
import { listCustomers } from "@/lib/customers/queries";
import { toCustomer } from "@/lib/customers/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("customers.view");
  if (denied) return denied;
  const parsed = adminCustomerListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listCustomers({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ?? null,
    registered: queryBool(q.registered),
    active: queryBool(q.active),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toCustomer),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
