// Admin single setting: read + value update (keys are fixed).
// Reads: settings.view. Writes: settings.manage. Values validate against
// the row's frozen value_type (DB CHECK re-verifies); updated_by records
// the actor; the mutation pairs an audit row in-tx. Unknown keys 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { checkPermission } from "@/lib/auth/rbac";
import { settingPatchSchema } from "@/lib/admin/validation";
import { getSetting } from "@/lib/admin/queries";
import { patchSetting } from "@/lib/admin/writes";
import { toSetting } from "@/lib/admin/serialize";

const keySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(120)
  .refine((s) => !/\s/.test(s), { message: "Invalid setting key." });

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const denied = await denyUnless("settings.view");
  if (denied) return denied;
  const { key } = await context.params;
  const parsedKey = keySchema.safeParse(key);
  if (!parsedKey.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid setting key."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getSetting(parsedKey.data);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Setting not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toSetting(row));
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const auth = await checkPermission("settings.manage");
  if (auth.ok === false) {
    const r = fail(
      new ApiError(
        auth.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        auth.code === "UNAUTHENTICATED" ? "Authentication required." : "Forbidden.",
      ),
    );
    return NextResponse.json(r.body, { status: r.status });
  }
  const { key } = await context.params;
  const parsedKey = keySchema.safeParse(key);
  if (!parsedKey.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid setting key."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = settingPatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid setting."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const updated = await patchSetting(parsedKey.data, parsed.data.value, auth.admin.user.id);
    if (!updated) {
      const r = fail(new ApiError("NOT_FOUND", "Setting not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok(toSetting(updated));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
