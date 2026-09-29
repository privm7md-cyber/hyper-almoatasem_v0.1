// Admin replacement proposal (staff).
// Permission: orders.update (closest frozen capability — fulfillment-adjacent
// order mutation; no replacement key exists and none is invented).
// OOS-driven by default (PENDING→UNAVAILABLE same-tx); swap mode keeps the
// line PENDING frozen (R2). Sequential re-proposals allowed on UNAVAILABLE
// originals; open-proposal races answer 409 via the partial UQ.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { proposeInputSchema } from "@/lib/replacements/validation";
import { proposeReplacement } from "@/lib/replacements/writes";
import { getReplacement } from "@/lib/replacements/queries";
import { toReplacement } from "@/lib/replacements/serialize";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
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
  const parsed = proposeInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid proposal."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const id = await proposeReplacement({
      orderId,
      orderItemId: itemId,
      replacementVariantId: parsed.data.replacementVariantId,
      replacementQuantity: parsed.data.replacementQuantity,
      reason: parsed.data.reason ?? null,
      markUnavailable: parsed.data.markUnavailable ?? true,
      proposerType: "STAFF",
      proposerId: auth.admin.user.id,
    });
    const full = await getReplacement(id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Replacement not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toReplacement(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
