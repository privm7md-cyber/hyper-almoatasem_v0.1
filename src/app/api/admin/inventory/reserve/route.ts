// Admin inventory reserve primitive (checkout foundation for BA-6).
// Atomic reserved-only bump, NO movement (frozen §J). 409 on insufficient
// availability (single-winner race loser re-reads). Permission: inventory.adjust.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { reserveInputSchema } from "@/lib/inventory/validation";
import { reserveStock } from "@/lib/inventory/service";
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
  const parsed = reserveInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid reservation."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await reserveStock(parsed.data.productVariantId, parsed.data.quantity, auth.admin.user.id);
    const row = await getInventory(parsed.data.productVariantId);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Inventory not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(
      toInventory({
        productVariantId: row.productVariantId,
        quantity: row.quantity,
        reservedQuantity: row.reservedQuantity,
        availableQuantity: row.availableQuantity,
        lowStockThreshold: row.lowStockThreshold,
        updatedAt: row.updatedAt,
      }),
    );
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
