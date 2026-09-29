// Admin inventory adjustment: quantity delta + paired movement, one tx.
// Permission: inventory.adjust. Movement types here are manual-stock only
// (STOCK_IN / ADJUSTMENT / WASTE / RETURN); SALE / CANCELLED_ORDER /
// REPLACEMENT belong to order flows (BA-6/BA-7) and are rejected with 400.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { adjustInputSchema } from "@/lib/inventory/validation";
import { adjustStock } from "@/lib/inventory/service";
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
  const parsed = adjustInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid adjustment."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const out = await adjustStock({
      variantId: parsed.data.productVariantId,
      delta: parsed.data.delta,
      movementType: parsed.data.movementType,
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
