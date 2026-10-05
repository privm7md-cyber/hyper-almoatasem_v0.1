// Admin role members: users holding a role (read-only observability for the
// delete-held-409 constraint). Reads: roles.view. No audit (read path).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema, paginationSchema } from "@/lib/api/validation";
import { getRole, listRoleMembers } from "@/lib/admin/queries";
import { toAdminUser } from "@/lib/admin/serialize";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("roles.view");
  if (denied) return denied;
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid role id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = paginationSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const role = await getRole(id);
  if (!role) {
    const r = fail(new ApiError("NOT_FOUND", "Role not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listRoleMembers(id, {
    limit: q.limit,
    cursor: q.cursor ?? null,
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map((m) => toAdminUser(m.user)),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}
