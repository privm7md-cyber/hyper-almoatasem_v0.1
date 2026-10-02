// Admin product media: list + register (metadata only, never binary).
// Reads: products.view. Register: products.update. Every mutation pairs an
// audit row in the same tx. Requires the product_images objects
// (db/future/product-images.sql); without them the query fails LOUD.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { imageInputSchema } from "@/lib/catalog/validation";
import { listImages, registerImage } from "@/lib/catalog/media";
import { toGallery, toMediaImage } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const rows = await listImages(id);
    const r = ok(toGallery(rows));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = imageInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid image."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await registerImage(
      id,
      {
        url: parsed.data.url,
        altText: parsed.data.altText ?? undefined,
        mimeType: parsed.data.mimeType ?? undefined,
        byteSize: parsed.data.byteSize ?? undefined,
        width: parsed.data.width ?? undefined,
        height: parsed.data.height ?? undefined,
        sortOrder: parsed.data.sortOrder ?? undefined,
        isPrimary: parsed.data.isPrimary ?? undefined,
      },
      gate.admin.user.id,
    );
    const r = created(toMediaImage(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
