// Admin inventory: list (explicit filters + bounded cursor pagination).
// Read permission: inventory.view. Availability filtering uses the DB
// GENERATED column (never JS math).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { inventoryListQuerySchema, queryBool } from "@/lib/inventory/validation";
import { listInventory } from "@/lib/inventory/queries";
import { toInventory } from "@/lib/inventory/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("inventory.view");
  if (denied) return denied;
  const parsed = inventoryListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listInventory({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ?? null,
    productId: q.productId ?? null,
    inStock: queryBool(q.inStock),
    lowStock: queryBool(q.lowStock),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((row) => ({
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
    })),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
