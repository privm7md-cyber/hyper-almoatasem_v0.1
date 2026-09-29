// Shared admin route guard (BA-2).
// Server-side RBAC only: session + effective permission via checkPermission.
// Returns null when allowed, otherwise a ready 401/403 NextResponse.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail } from "@/lib/api/respond";
import { checkPermission, type AdminContext } from "@/lib/auth/rbac";

export async function denyUnless(permission: string): Promise<NextResponse | null> {
  const auth = await checkPermission(permission);
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  return null;
}

/**
 * Same gate as denyUnless but also yields the authenticated admin context
 * (PRE-BA-11 audit retrofit: audited writes need the actor id server-side).
 * Identical 401/403 semantics; callers branch on `"denied" in gate`.
 */
export async function adminOrDeny(
  permission: string,
): Promise<{ admin: AdminContext } | { denied: NextResponse }> {
  const auth = await checkPermission(permission);
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return { denied: NextResponse.json(r.body, { status: r.status }) };
  }
  return { admin: auth.admin };
}
