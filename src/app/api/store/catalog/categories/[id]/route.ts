// Public storefront: single category (active rows only).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/api/validation";
import { getCategory } from "@/lib/catalog/queries";
import { toCategory } from "@/lib/catalog/serialize";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    const r = fail(new ApiError("VALIDATION", "Invalid category id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await getCategory(id, false);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Category not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toCategory(row));
  return NextResponse.json(r.body, { status: r.status });
}

