// Public storefront: product availability via the frozen
// product_stock_status VIEW (single definition of "product in stock").
// Active product only; per-variant truth stays in available_quantity.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { prisma } from "@/lib/db";
import { getProductStockStatus } from "@/lib/inventory/queries";
import { toInventory } from "@/lib/inventory/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const product = await prisma.product.findFirst({
    where: { id, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!product) {
    const r = fail(new ApiError("NOT_FOUND", "Product not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const status = await getProductStockStatus(id);
  const variants = await prisma.inventory.findMany({
    where: { variant: { productId: id, isActive: true, deletedAt: null } },
    select: {
      productVariantId: true,
      quantity: true,
      reservedQuantity: true,
      availableQuantity: true,
      lowStockThreshold: true,
      updatedAt: true,
    },
    orderBy: [{ productVariantId: "asc" }],
  });
  const r = ok(
    {
      productId: id,
      sellableVariants: status?.sellableVariants ?? 0,
      inStockVariants: status?.inStockVariants ?? 0,
      isInStock: status?.isInStock ?? false,
      variants: variants.map((v) =>
        toInventory({
          productVariantId: v.productVariantId,
          quantity: v.quantity,
          reservedQuantity: v.reservedQuantity,
          availableQuantity: v.availableQuantity,
          lowStockThreshold: v.lowStockThreshold,
          updatedAt: v.updatedAt,
        }),
      ),
    },
    {},
  );
  return NextResponse.json(r.body, { status: r.status });
}
