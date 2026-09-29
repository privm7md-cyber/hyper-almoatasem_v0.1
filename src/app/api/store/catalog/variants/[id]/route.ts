// Public storefront: single variant (active rows only, no cost basis).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getVariant } from "@/lib/catalog/queries";
import { toVariant } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid variant id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getVariant(id, false);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Variant not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toVariant(row));
  return NextResponse.json(r.body, { status: r.status });
}

