// Storefront replacement list for one owned order.
// PHASE 2: the owner is the server-verified session — no ?customerId=.
// Foreign/unknown orders read as an empty-missing 404.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { listReplacementsForCustomerOrder } from "@/lib/replacements/queries";
import { requireCustomer } from "@/lib/customers/session";
import { toReplacement } from "@/lib/replacements/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request);
    const rows = await listReplacementsForCustomerOrder(orderId, me.customerId);
    if (!rows) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(rows.map(toReplacement));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
