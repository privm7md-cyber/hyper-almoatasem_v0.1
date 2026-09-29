// Admin replacement list for one order (staff visibility into open and
// decided proposals). Read permission: orders.view.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { listReplacementsByOrder } from "@/lib/replacements/queries";
import { toReplacement } from "@/lib/replacements/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("orders.view");
  if (denied) return denied;
  const { id: orderId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid order id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const rows = await listReplacementsByOrder(orderId);
  if (!rows) {
    const r = fail(new ApiError("NOT_FOUND", "Order not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(rows.map(toReplacement));
  return NextResponse.json(r.body, { status: r.status });
}
