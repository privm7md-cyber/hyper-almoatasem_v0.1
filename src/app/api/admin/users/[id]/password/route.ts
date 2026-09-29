// Admin credential provisioning: set a user's password.
// Permission: users.manage ("provision ... admin users"). Policy + Argon2id
// via the existing auth infrastructure; lockout reset + revoke-all in the
// same tx; audit row paired. The secret travels only in this body and is
// never logged, stored, or returned (policy failures answer 422).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { userPasswordSchema } from "@/lib/admin/validation";
import { setUserPassword } from "@/lib/admin/writes";
import { toAdminUser } from "@/lib/admin/serialize";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await checkPermission("users.manage");
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
  const parsed = userPasswordSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid password."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await setUserPassword(id, parsed.data.password, auth.admin.user.id);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "User not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toAdminUser(updated));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
