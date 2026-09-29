// Admin single permission (frozen registry row, read-only).
// Permission: roles.view (documented mapping — see list route).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { getPermission } from "@/lib/admin/queries";
import { toPermission } from "@/lib/admin/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("roles.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid permission id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getPermission(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Permission not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toPermission(row));
  return NextResponse.json(r.body, { status: r.status });
}
