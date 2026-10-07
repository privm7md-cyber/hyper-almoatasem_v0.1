// Admin fulfillment: mark one PENDING line unavailable (OOS, no stock).
// Permission: orders.update. Flips to UNAVAILABLE (hold is NOT released
// here — substituted originals release at approve time, unsubstituted
// shorts release at READY; one tx + audit); a later approved substitute
// materializes its own line via the replacement flow, a rejected/absent
// one leaves the line short-shipped (final 0 at READY).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { markLineUnavailable } from "@/lib/orders/fulfillment";
import { getOrderFull } from "@/lib/orders/queries";
import { toOrder } from "@/lib/orders/serialize";

export async function POST(_request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await checkPermission("orders.update");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id: orderId, itemId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success || !uuidSchema.safeParse(itemId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order item id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await markLineUnavailable({ orderId, itemId, actorId: auth.admin.user.id });
    const full = await getOrderFull(orderId);
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
