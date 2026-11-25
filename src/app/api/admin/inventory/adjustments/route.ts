// Safe operational adjustment; legacy /adjust remains non-idempotent.
import { NextResponse } from "next/server";
import { adminOrDeny } from "@/lib/api/route-auth";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { safeAdjustmentSchema } from "@/lib/inventory/validation";
import { adjustStock } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const gate = await adminOrDeny("inventory.adjust");
  if ("denied" in gate) return gate.denied;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError("VALIDATION", "Invalid request body."); }
    const parsed = safeAdjustmentSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("VALIDATION", "Invalid safe adjustment.");
    const input = parsed.data;
    const output = await adjustStock({
      variantId: input.productVariantId, delta: input.delta, movementType: input.movementType,
      referenceType: "MANUAL", referenceId: input.requestId, reason: input.reason,
      actorId: gate.admin.user.id,
    }, { requestId: input.requestId, expectedQuantity: input.expectedQuantity, confirmed: true });
    // Return the durable movement outcome, not a later/non-atomic inventory read.
    const response = created(output);
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    const response = fail(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
