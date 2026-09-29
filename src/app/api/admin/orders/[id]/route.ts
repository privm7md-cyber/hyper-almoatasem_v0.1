// Admin single order (full snapshot + items + history).
// Read permission: orders.view.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { getOrderFull } from "@/lib/orders/queries";
import { toOrder } from "@/lib/orders/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("orders.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getOrderFull(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Order not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({ order: toOrder(row) });
  return NextResponse.json(r.body, { status: r.status });
}
