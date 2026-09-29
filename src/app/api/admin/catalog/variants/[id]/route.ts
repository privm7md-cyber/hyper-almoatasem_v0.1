// Admin catalog: single variant GET + PATCH (cost basis visible here;
// never on storefront shapes). Price changes go through ./price (history).
// Reads: products.view. Updates: products.update.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { variantInputSchema } from "@/lib/catalog/validation";
import { getVariant } from "@/lib/catalog/queries";
import { patchVariant } from "@/lib/catalog/writes";
import { toAdminVariant } from "@/lib/catalog/serialize";

const variantPatchSchema = variantInputSchema.omit({ productId: true, price: true }).partial();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getVariant(id, true);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toAdminVariant(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
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
  const parsed = variantPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await patchVariant(id, parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toAdminVariant(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
