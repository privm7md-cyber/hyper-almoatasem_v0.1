// Admin inventory detail + threshold edit for one variant.
// GET: inventory.view. PATCH (lowStockThreshold only): inventory.adjust.
// Threshold is display-level (no movement, no stock guard).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { thresholdPatchSchema } from "@/lib/inventory/validation";
import { getInventory } from "@/lib/inventory/queries";
import { setLowStockThreshold } from "@/lib/inventory/service";
import { toInventory } from "@/lib/inventory/serialize";

export async function GET(_request: Request, context: { params: Promise<{ variantId: string }> }) {
  const denied = await denyUnless("inventory.view");
  if (denied) return denied;
  const { variantId } = await context.params;
  if (!uuidSchema.safeParse(variantId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getInventory(variantId);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Inventory not found."));
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
    variant: {
      id: row.variant.id,
      name: row.variant.name,
      sizeUnit: row.variant.sizeUnit,
      isActive: row.variant.isActive,
      product: {
        id: row.variant.product.id,
        name: row.variant.product.name,
        slug: row.variant.product.slug,
        productType: row.variant.product.productType,
        unit: row.variant.product.unit,
        saleStepGrams: row.variant.product.saleStepGrams,
      },
    },
  });
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ variantId: string }> }) {
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
  const { variantId } = await context.params;
  if (!uuidSchema.safeParse(variantId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = thresholdPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid threshold."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await setLowStockThreshold(variantId, parsed.data.lowStockThreshold, auth.admin.user.id);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Inventory not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const row = await getInventory(variantId);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Inventory not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(
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
