// Storefront replacement decision (explicit customer approval/rejection).
// Body { customerId, action }: the replacement must belong to the path
// order AND the order to the customer (else 404). Approve runs full R10
// materialization as CUSTOMER; reject flips to CUSTOMER_REJECTED with no
// inventory effect. Decided proposals answer 409 (never silent replays).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { decideInputSchema } from "@/lib/replacements/validation";
import { getReplacement } from "@/lib/replacements/queries";
import { decideReplacement } from "@/lib/replacements/writes";
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
    const existing = await getReplacement(replacementId);
    if (
      !existing ||
      existing.originalItem.orderId !== orderId ||
      existing.originalItem.order.customerId !== parsed.data.customerId
    ) {
      const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    await decideReplacement({
      replacementId,
      expectedOrderId: orderId,
      outcome: parsed.data.action,
      deciderType: "CUSTOMER",
      deciderId: parsed.data.customerId,
    });
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
