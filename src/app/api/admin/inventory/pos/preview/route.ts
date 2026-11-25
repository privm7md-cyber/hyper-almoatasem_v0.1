import { NextResponse } from "next/server";
import { adminOrDenyAll } from "@/lib/api/route-auth";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { boundedForm } from "@/lib/api/bounded-body";
import { parseInventoryFile } from "@/lib/inventory/import-file";
import { posImportPreview } from "@/lib/inventory/pos-import";

export async function POST(request: Request) {
  const gate = await adminOrDenyAll(["inventory.view", "inventory.adjust"]);
  if ("denied" in gate) return gate.denied;
  try {
    const form = await boundedForm(request, 8 * 1024 * 1024);
    const file = form.get("file");
    const name = form.get("fileName");
    if (!(file instanceof File) || !name || typeof name !== "string") throw new ApiError("VALIDATION", "Select a POS file.");
    const table = await parseInventoryFile(Buffer.from(await file.arrayBuffer()), name);
    const categoryIdDefault = form.get("categoryIdDefault");
    const { parsed } = await posImportPreview({ categoryIdDefault: typeof categoryIdDefault === "string" ? categoryIdDefault : undefined }, table);
    const r = ok({ table, parsed });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) { const r = fail(error); return NextResponse.json(r.body, { status: r.status }); }
}
