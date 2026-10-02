// Public storefront product gallery (delivery references only).
// Deterministic fallback: primary ?? first-by-order ?? null; empty gallery
// (never a broken URL). Requires the product_images objects; unknown
// products answer 404 (never leak existence beyond the active gate).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getProduct } from "@/lib/catalog/queries";
import { listImages } from "@/lib/catalog/media";
import { toGallery } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const product = await getProduct(id, false);
  if (!product) {
    const r = fail(new ApiError("NOT_FOUND", "Product not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const r = ok(toGallery(await listImages(id)));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
