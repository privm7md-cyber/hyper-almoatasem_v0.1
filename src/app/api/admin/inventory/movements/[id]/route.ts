// Admin inventory movement detail (single audit row).
// Read permission: inventory.view.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { getMovement } from "@/lib/inventory/queries";
import { toMovement } from "@/lib/inventory/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("inventory.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid movement id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getMovement(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Movement not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(
    toMovement({
      id: row.id,
      productVariantId: row.productVariantId,
      movementType: row.movementType,
      quantity: row.quantity,
      previousQuantity: row.previousQuantity,
      newQuantity: row.newQuantity,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      reason: row.reason,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }),
  );
  return NextResponse.json(r.body, { status: r.status });
}
