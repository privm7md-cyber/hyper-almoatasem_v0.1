// Storefront replacement decision (explicit customer-side approval/rejection).
// Access is session ownership XOR guest order credential (BG-Guest-Order):
// the decider is the server-verified session (no customerId in body) or the
// guest credential holder for that order (decider GUEST/NULL). The
// replacement must belong to the path order AND the order to the accessor
// (else 404). Approve runs full R10 materialization; reject flips to
// CUSTOMER_REJECTED with no inventory effect. Decided proposals answer 409
// (never silent replays). Expired credential → 410 Gone.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { decideInputSchema } from "@/lib/replacements/validation";
import { getReplacement } from "@/lib/replacements/queries";
import { decideReplacement } from "@/lib/replacements/writes";
import { requireCustomer } from "@/lib/customers/session";
import { requireGuestOrder } from "@/lib/orders/guest-access";
import { toReplacement } from "@/lib/replacements/serialize";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; replacementId: string }> },
) {
  const { id: orderId, replacementId } = await context.params;
  if (!uuidSchema.safeParse(orderId).success || !uuidSchema.safeParse(replacementId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid replacement id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = decideInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid decision."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const me = await requireCustomer(request).catch(() => null);
    const existing = await getReplacement(replacementId);
    if (!existing || existing.originalItem.orderId !== orderId) {
      const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    if (me) {
      if (existing.originalItem.order.customerId !== me.customerId) {
        const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      await decideReplacement({
        replacementId,
        expectedOrderId: orderId,
        outcome: parsed.data.action,
        deciderType: "CUSTOMER",
        deciderId: me.customerId,
      });
    } else {
      // Guest separation: the order must be a guest order (credential rows
      // exist only for customer_id NULL orders — verified again here).
      await requireGuestOrder(request, orderId);
      if (existing.originalItem.order.customerId !== null) {
        const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
        return NextResponse.json(r.body, { status: r.status });
      }
      await decideReplacement({
        replacementId,
        expectedOrderId: orderId,
        outcome: parsed.data.action,
        deciderType: "GUEST",
        deciderId: null,
      });
    }
    const full = await getReplacement(replacementId);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toReplacement(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
