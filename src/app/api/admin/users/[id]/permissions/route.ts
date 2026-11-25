// ADMIN USER EFFECTIVE PERMISSIONS — "what can this account actually do?"
//
// Read permission: `users.view` + `roles.view` (both are required: the answer
// is about one account AND about the permission structure).
//
// The answer keeps the states apart (code / database / granted / allowed
// here) and never presents a defined-but-not-granted sensitive capability as
// an active one.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnlessAll } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { actorCeilingMap, effectivePermissionsFor } from "@/lib/admin/effective-permissions";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessAll(["users.view", "roles.view"]);
  if (denied) return denied;
  const auth = await checkPermission("roles.view");
  if (auth.ok === false) {
    const r = fail(new ApiError("FORBIDDEN", "Forbidden."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid user id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const report = await effectivePermissionsFor(id, auth.admin.permissions);
    if (!report) {
      const r = fail(new ApiError("NOT_FOUND", "User not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ ...report, allowedHere: actorCeilingMap(auth.admin.permissions) });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
