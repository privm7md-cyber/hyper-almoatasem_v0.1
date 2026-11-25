// Admin user-role removal. Permission: roles.manage (grant management).
// Missing mapping answers 404. Last-active-SUPER_ADMIN mapping removal
// answers 409 (final-RBAC guard); error mapping via fail().
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { verifySameOrigin } from "@/lib/api/request-context";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { removeRole } from "@/lib/admin/writes";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; roleId: string }> }) {
  if (!verifySameOrigin(request.headers, request.url)) {
    const r = fail(new ApiError("FORBIDDEN", "Cross-origin mutation is not permitted."));
    return NextResponse.json(r.body, { status: r.status });
  }
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
  const { id, roleId } = await context.params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(roleId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role assignment id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const done = await removeRole(id, roleId, auth.admin.user.id, auth.admin.permissions, auth.admin.roles);
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Role assignment not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ removed: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
