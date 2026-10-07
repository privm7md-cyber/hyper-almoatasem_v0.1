// Admin fulfillment: pick one order line (PREPARING only).
// Permission: orders.update. Body { actualQuantity } — the weighed fact
// (R7 envelope enforced in-domain; breach → 422, stock-short → 409).
// Commits stock (quantity -= actual, reserved -= requested) + SALE(-actual)
// movement + FULFILLED/PARTIALLY_FULFILLED flip, one tx with staff audit.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { pickLineSchema } from "@/lib/orders/validation";
import { pickOrderLine } from "@/lib/orders/fulfillment";
import { getOrderFull } from "@/lib/orders/queries";
import { toOrder } from "@/lib/orders/serialize";

export async function POST(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = pickLineSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid pick."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await pickOrderLine({
      orderId,
      itemId,
      actualQuantity: parsed.data.actualQuantity,
      actorId: auth.admin.user.id,
    });
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
