// Admin single image: patch (alt/sort/promote, atomic primary switch) +
// hard-delete metadata (physical objects belong to the future provider).
// Patch: products.update. Delete: products.delete. Mutations audited.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { imagePatchSchema } from "@/lib/catalog/validation";
import { deleteImage, patchImage } from "@/lib/catalog/media";
import { toMediaImage } from "@/lib/catalog/serialize";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid image id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = imagePatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid image."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await patchImage(
      id,
      {
        altText: parsed.data.altText ?? undefined,
        sortOrder: parsed.data.sortOrder ?? undefined,
        isPrimary: parsed.data.isPrimary ?? undefined,
      },
      gate.admin.user.id,
    );
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Image not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toMediaImage(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.delete");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid image id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const done = await deleteImage(id, gate.admin.user.id);
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Image not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ deleted: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
