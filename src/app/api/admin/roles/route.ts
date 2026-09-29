// Admin roles: list + create (data rows, never enums).
// Reads: roles.view. Creates: roles.manage.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { roleInputSchema, roleListQuerySchema, queryBool } from "@/lib/admin/validation";
import { listRoles, getRole } from "@/lib/admin/queries";
import { createRole } from "@/lib/admin/writes";
import { toRole } from "@/lib/admin/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("roles.view");
  if (denied) return denied;
  const parsed = roleListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listRoles({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ?? null,
    active: queryBool(q.active),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((role) => toRole(role)),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(request: Request) {
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = roleInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const createdRow = await createRole(parsed.data, auth.admin.user.id);
    const full = await getRole(createdRow.id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "Role not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toRole(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
