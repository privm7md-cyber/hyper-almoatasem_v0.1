import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { getProductDeletionEligibility } from "@/lib/catalog/lifecycle";

// Inspection is restricted to the destructive capability; no executable DELETE.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.delete");
  if (denied) return denied;
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new ApiError("VALIDATION", "Invalid product id.");
    const r = ok(await getProductDeletionEligibility(id));
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
