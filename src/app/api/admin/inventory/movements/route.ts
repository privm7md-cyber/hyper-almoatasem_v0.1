// Admin inventory movements: append-only audit ledger reads.
// Read permission: inventory.view. Bounded cursor pagination, whitelisted
// filters only (variant, movement type, reference pair).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { movementListQuerySchema } from "@/lib/inventory/validation";
import { listMovements } from "@/lib/inventory/queries";
import { toMovement } from "@/lib/inventory/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("inventory.view");
  if (denied) return denied;
  const parsed = movementListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listMovements({
    limit: q.limit,
    cursor: q.cursor ?? null,
    variantId: q.variantId ?? null,
    movementType: q.movementType ?? null,
    referenceType: q.referenceType ?? null,
    referenceId: q.referenceId ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((m) =>
      toMovement({
        id: m.id,
        productVariantId: m.productVariantId,
        movementType: m.movementType,
        quantity: m.quantity,
        previousQuantity: m.previousQuantity,
        newQuantity: m.newQuantity,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        reason: m.reason,
        createdBy: m.createdBy,
        createdAt: m.createdAt,
      }),
    ),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
