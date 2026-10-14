// Storefront single order (snapshot read, ownership-scoped).
// Access is session ownership XOR guest order credential (BG-Guest-Order):
// registered path unchanged (no ?customerId=); guest path presents
// `x-guest-order-token` bound to this order id. Foreign/unknown → 404;
// expired credential → 410 Gone.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getCustomerOrder } from "@/lib/orders/queries";
import { requireCustomer } from "@/lib/customers/session";
import { requireGuestOrder } from "@/lib/orders/guest-access";
import { toOrder } from "@/lib/orders/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request).catch(() => null);
    if (me) {
      const row = await getCustomerOrder(id, me.customerId);
      if (!row) {
        const r = fail(new ApiError("NOT_FOUND", "Order not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      const r = ok({ order: toOrder(row) });
      return NextResponse.json(r.body, { status: r.status });
    }
    const full = await requireGuestOrder(request, id);
    const r = ok({ order: toOrder(full) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
