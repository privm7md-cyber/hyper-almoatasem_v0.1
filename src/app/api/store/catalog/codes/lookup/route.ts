// Public storefront: cashier/scan path — global code lookup resolving to
// exactly one variant + product. Active rows only. Returns price basis and
// size info; weighed totals are NOT computed here (formula deferred, BA-0).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { codeLookupQuerySchema } from "@/lib/catalog/validation";
import { resolveProductCode } from "@/lib/catalog/queries";
import { toCodeResolution } from "@/lib/catalog/serialize";

export async function GET(request: Request) {
  const parsed = codeLookupQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid code."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await resolveProductCode(parsed.data.code, false);
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Product code not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok(toCodeResolution(row));
  return NextResponse.json(r.body, { status: r.status });
}

