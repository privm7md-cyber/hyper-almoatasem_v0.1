// Admin inventory commit primitive (picking foundation for BA-6).
// Strict R3: quantity -= actual AND reserved -= requested atomically iff
// (quantity - reserved + requested) >= actual, plus the R7 envelope gate,
// plus a paired SALE movement (signed -actual). 422 on envelope breach;
// 409 on stock-predicate failure (no auto-cap here — BA-6 owns capping).
// Permission: inventory.adjust.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { commitInputSchema } from "@/lib/inventory/validation";
import { commitStock } from "@/lib/inventory/service";
import { getInventory } from "@/lib/inventory/queries";
import { toInventory } from "@/lib/inventory/serialize";

export async function POST(request: Request) {
  const auth = await checkPermission("inventory.adjust");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = commitInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid commit."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const out = await commitStock({
      variantId: parsed.data.productVariantId,
      requested: parsed.data.requested,
      actual: parsed.data.actual,
      referenceType: parsed.data.referenceType ?? null,
      referenceId: parsed.data.referenceId ?? null,
      reason: parsed.data.reason ?? null,
      actorId: auth.admin.user.id,
    });
    const row = await getInventory(parsed.data.productVariantId);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Inventory not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created({
      inventory: toInventory({
        productVariantId: row.productVariantId,
        quantity: row.quantity,
        reservedQuantity: row.reservedQuantity,
        availableQuantity: row.availableQuantity,
        lowStockThreshold: row.lowStockThreshold,
        updatedAt: row.updatedAt,
      }),
      movementId: out.movementId,
      previousQuantity: out.previousQuantity,
      newQuantity: out.newQuantity,
    });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
