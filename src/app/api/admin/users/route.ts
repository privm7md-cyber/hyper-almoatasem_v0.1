// Admin users: list + provision (identity only — credentials via
// [id]/password). Reads: users.view. Creates: users.manage. Password
// hashes never cross the boundary (omitted by construction).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { userInputSchema, userListQuerySchema, queryBool } from "@/lib/admin/validation";
import { listUsers, getUser } from "@/lib/admin/queries";
import { createUser } from "@/lib/admin/writes";
import { toAdminUser } from "@/lib/admin/serialize";

export async function GET(request: Request) {
  const denied = await denyUnless("users.view");
  if (denied) return denied;
  const parsed = userListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid query."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const q = parsed.data;
  const rows = await listUsers({
    limit: q.limit,
    cursor: q.cursor ?? null,
    search: q.search ?? null,
    active: queryBool(q.active),
  });
  const page = rows.length > q.limit ? rows.slice(0, q.limit) : rows;
  const r = ok(
    page.map(toAdminUser),
    { limit: q.limit, nextCursor: rows.length > q.limit ? page[page.length - 1].id : null },
  );
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(request: Request) {
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = userInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid user."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const createdRow = await createUser(parsed.data, auth.admin.user.id);
    const full = await getUser(createdRow.id);
    if (!full) {
      const r = fail(new ApiError("NOT_FOUND", "User not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = created(toAdminUser(full));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
