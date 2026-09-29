// Admin role grants: attach a permission to a role.
// Permission: roles.manage. Duplicates answer 409 via the pair UQ.
// Effective-permission ceiling: the permission must lie within the
// actor's effective set (403 otherwise, atomic).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { grantInputSchema } from "@/lib/admin/validation";
import { assignGrant } from "@/lib/admin/writes";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("roles.manage");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = grantInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid grant."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await assignGrant(id, parsed.data.permissionId, auth.admin.user.id, auth.admin.permissions);
    const r = created({ roleId: id, permissionId: parsed.data.permissionId });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
