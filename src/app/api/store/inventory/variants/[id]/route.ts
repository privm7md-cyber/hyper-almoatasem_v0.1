// Public storefront: variant availability (DB GENERATED value, read-only).
// Active rows only. No computed weighed totals (formula stays deferred).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getInventory } from "@/lib/inventory/queries";
import { toInventory } from "@/lib/inventory/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getInventory(id);
  if (!row || !row.variant.isActive || row.variant.deletedAt !== null) {
    const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({
    inventory: toInventory({
      productVariantId: row.productVariantId,
      quantity: row.quantity,
      reservedQuantity: row.reservedQuantity,
      availableQuantity: row.availableQuantity,
      lowStockThreshold: row.lowStockThreshold,
      updatedAt: row.updatedAt,
    }),
  });
  return NextResponse.json(r.body, { status: r.status });
}
