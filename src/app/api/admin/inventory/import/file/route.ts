import { NextResponse } from "next/server";
import { adminOrDenyAll } from "@/lib/api/route-auth";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { MAX_IMPORT_BYTES, parseInventoryFile } from "@/lib/inventory/import-file";
import {boundedForm} from "@/lib/api/bounded-body";

export async function POST(request:Request) {
  const gate=await adminOrDenyAll(["inventory.view","inventory.adjust"]);
  if("denied" in gate) return gate.denied;
  try {
    if(Number(request.headers.get("content-length") ?? 0)>MAX_IMPORT_BYTES+65536) throw new ApiError("VALIDATION","File too large.");
    const form=await boundedForm(request,MAX_IMPORT_BYTES+65536), file=form.get("file"), sheet=form.get("sheet");
    if(!(file instanceof File) || file.size>MAX_IMPORT_BYTES) throw new ApiError("VALIDATION","Select a file up to 5 MB.");
    const result=ok(await parseInventoryFile(Buffer.from(await file.arrayBuffer()),file.name,typeof sheet==="string" ? sheet : undefined));
    return NextResponse.json(result.body,{status:result.status});
  } catch(error) { const result=fail(error); return NextResponse.json(result.body,{status:result.status}); }
}
