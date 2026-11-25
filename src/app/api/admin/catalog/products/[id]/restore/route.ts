import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { lifecycleInputSchema, transitionProduct } from "@/lib/catalog/lifecycle";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("VALIDATION", "Invalid product id.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError("VALIDATION", "Invalid request body."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("VALIDATION", "Invalid product lifecycle request.");
    const ifMatch = request.headers.get("if-match");
    const parsed = lifecycleInputSchema.safeParse({ ...body, ...(ifMatch !== null ? { expectedUpdatedAt: ifMatch.trim().replace(/^"|"$/g, "") } : {}) });
    if (!parsed.success) throw new ApiError("VALIDATION", "Invalid product lifecycle request.");
    const result = await transitionProduct(id, "restore", parsed.data, gate.admin.user.id);
    const r = ok(result);
    return NextResponse.json(r.body, { status: r.status, headers: { ETag: `"${result.updatedAt}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
