// Storefront replacement list for one owned order.
// Access is session ownership XOR guest order credential (BG-Guest-Order):
// registered path unchanged (no ?customerId=); guest path presents
// `x-guest-order-token` bound to this order id. Foreign/unknown → 404;
// expired credential → 410 Gone.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import {
  listReplacementsForCustomerOrder,
  listReplacementsForGuestOrder,
} from "@/lib/replacements/queries";
import { requireCustomer } from "@/lib/customers/session";
import { requireGuestOrder } from "@/lib/orders/guest-access";
import { toReplacement } from "@/lib/replacements/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request).catch(() => null);
    const rows = me
      ? await listReplacementsForCustomerOrder(orderId, me.customerId)
      : await (async () => {
          await requireGuestOrder(request, orderId);
          return listReplacementsForGuestOrder(orderId);
        })();
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
