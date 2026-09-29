// Admin role grant removal. Permission: roles.manage.
// Missing mappings answer 404. SUPER_ADMIN grants are protected (403,
// PRE-BA-11 decision #1); normal-role removals stay permitted.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { removeGrant } from "@/lib/admin/writes";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; permissionId: string }> }) {
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
  const { id, permissionId } = await context.params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(permissionId).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid grant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const done = await removeGrant(id, permissionId, auth.admin.user.id);
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Grant not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ removed: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
