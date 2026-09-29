// Storefront order cancel (owner-scoped, unpicked orders only).
// Body { customerId } must own the order; NEW|CONFIRMED → CANCELLED with
// reservation release (zero movements), one tx. Picked/further states → 409
// (fulfillment-gated cancel is a later phase).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { orderCancelSchema } from "@/lib/orders/validation";
import { getCustomerOrder, getOrderFull } from "@/lib/orders/queries";
import { cancelOrder } from "@/lib/orders/writes";
import { toOrder } from "@/lib/orders/serialize";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = orderCancelSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid cancel request."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const owned = await getCustomerOrder(id, parsed.data.customerId);
    if (!owned) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    await cancelOrder({ orderId: id, actorType: "CUSTOMER", actorId: parsed.data.customerId });
    const full = await getOrderFull(id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Order not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ order: toOrder(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
