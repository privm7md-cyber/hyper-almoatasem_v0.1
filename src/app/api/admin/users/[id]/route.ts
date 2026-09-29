// Admin single user: detail + edit (name/email/phone/active).
// Reads: users.view. Writes: users.manage. No hard delete exists (history
// pins actors via RESTRICT — deactivation is the lifecycle).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { userPatchSchema } from "@/lib/admin/validation";
import { getUser } from "@/lib/admin/queries";
import { patchUser } from "@/lib/admin/writes";
import { toAdminUser } from "@/lib/admin/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("users.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid user id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getUser(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "User not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toAdminUser(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const parsed = userPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid user."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await patchUser(
      id,
      {
        name: parsed.data.name ?? undefined,
        email: parsed.data.email ?? undefined,
        phone: parsed.data.phone,
        isActive: parsed.data.isActive ?? undefined,
      },
      auth.admin.user.id,
    );
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
