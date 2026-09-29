// Admin catalog: code create. Permission: products.create.
// Global code UNIQUE violations surface as 409 (never raw DB errors).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { created, fail } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { codeInputSchema } from "@/lib/catalog/validation";
import { createCode } from "@/lib/catalog/writes";

export async function POST(request: Request) {
  const gate = await adminOrDeny("products.create");
  if ("denied" in gate) return gate.denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = codeInputSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product code."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await createCode(parsed.data, gate.admin.user.id);
    const r = created({ id: row.id, code: row.code, type: row.type, isPrimary: row.isPrimary });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
