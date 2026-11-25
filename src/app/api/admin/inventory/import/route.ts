import { NextResponse } from "next/server";
import { adminOrDenyAll } from "@/lib/api/route-auth";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { previewOrApplyInventoryImport } from "@/lib/inventory/import-service";
import {boundedJson} from "@/lib/api/bounded-body";

export async function POST(request:Request) {
  const gate=await adminOrDenyAll(["inventory.view","inventory.adjust"]);
  if("denied" in gate) return gate.denied;
  try {
    if(Number(request.headers.get("content-length") ?? 0)>8*1024*1024) throw new ApiError("VALIDATION","Import too large.");
    const body=await boundedJson(request,8*1024*1024);
    const result=ok(await previewOrApplyInventoryImport(body,gate.admin.user.id));
    return NextResponse.json(result.body,{status:result.status});
  } catch(error) { const result=fail(error); return NextResponse.json(result.body,{status:result.status}); }
}
