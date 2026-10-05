// Admin catalog: single category GET + PATCH (incl. deactivate/reactivate
// via is_active; no hard delete — frozen RESTRICT graph + soft flags).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { categoryPatchSchema } from "@/lib/catalog/validation";
import { getCategory } from "@/lib/catalog/queries";
import { patchCategory } from "@/lib/catalog/writes";
import { toCategory } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid category id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getCategory(id, true);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Category not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toCategory(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid category id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = categoryPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid category."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await patchCategory(id, parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Category not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toCategory(row));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
