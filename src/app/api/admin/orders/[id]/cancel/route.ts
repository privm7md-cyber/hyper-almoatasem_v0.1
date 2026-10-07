// Admin order cancel (staff, within unpicked policy).
// Permission: orders.cancel ("Cancel orders within policy" — frozen key).
// Same shared service as the storefront path (actor STAFF + admin id);
// NEW|CONFIRMED|PREPARING-unpicked → CANCELLED + reservation release, one tx.
// Picked lines (actuals set) → 409 via the fulfillment gate.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { getOrderFull } from "@/lib/orders/queries";
import { cancelOrder } from "@/lib/orders/writes";
import { toOrder } from "@/lib/orders/serialize";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("orders.cancel");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await cancelOrder({ orderId: id, actorType: "STAFF", actorId: auth.admin.user.id });
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
