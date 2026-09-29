// Admin single role: detail (with grant keys) / edit / hard-delete.
// Reads: roles.view. Writes: roles.manage. Frozen SUPER_ADMIN protection:
// rename and delete answer 403. Delete relies on RESTRICT FKs (granted or
// held roles answer 409).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { rolePatchSchema } from "@/lib/admin/validation";
import { getRole } from "@/lib/admin/queries";
import { deleteRole, patchRole } from "@/lib/admin/writes";
import { toRole } from "@/lib/admin/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("roles.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getRole(id);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Role not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toRole(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const parsed = rolePatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await patchRole(
      id,
      {
        name: parsed.data.name ?? undefined,
        description: parsed.data.description,
        isActive: parsed.data.isActive ?? undefined,
      },
      auth.admin.user.id,
    );
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Role not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const full = await getRole(id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Role not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toRole(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
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
  try {
    const done = await deleteRole(id, auth.admin.user.id);
    if (!done) {
      const r = fail(new ApiError("NOT_FOUND", "Role not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ deleted: true });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
