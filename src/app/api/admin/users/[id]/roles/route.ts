// Admin user-role assignment (grant management surface).
// Permission: roles.manage ("manage roles and grants") — assignment edits
// the grant graph even though nested under users (documented mapping).
// Duplicates answer 409 via the pair UQ (never ON CONFLICT DO NOTHING).
// Effective-permission ceiling: the role's effective set must lie within
// the actor's (403 otherwise, atomic).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { roleAssignSchema } from "@/lib/admin/validation";
import { assignRole } from "@/lib/admin/writes";

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
    const r = fail(new ApiError("VALIDATION", "Invalid user id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = roleAssignSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role assignment."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    await assignRole(id, parsed.data.roleId, auth.admin.user.id, auth.admin.permissions);
    const r = created({ userId: id, roleId: parsed.data.roleId });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
