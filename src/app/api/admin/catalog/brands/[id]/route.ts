// Admin catalog: single brand GET + PATCH (no hard delete).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { brandInputSchema } from "@/lib/catalog/validation";
import { getBrand } from "@/lib/catalog/queries";
import { patchBrand } from "@/lib/catalog/writes";
import { toBrand } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid brand id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getBrand(id, true);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Brand not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toBrand(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid brand id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = brandInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid brand."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await patchBrand(id, parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Brand not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toBrand(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
