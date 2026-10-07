// Storefront single order (snapshot read, ownership-scoped).
// PHASE 2: the customer is the server-verified session — no ?customerId=.
// Foreign/unknown → 404.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getCustomerOrder } from "@/lib/orders/queries";
import { requireCustomer } from "@/lib/customers/session";
import { toOrder } from "@/lib/orders/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request);
    const row = await getCustomerOrder(id, me.customerId);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ order: toOrder(row) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
