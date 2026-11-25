import { NextResponse } from "next/server";
import { adminOrDenyAll } from "@/lib/api/route-auth";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { revertStockImport, type RevertStockImportInput } from "@/lib/inventory/revert-service";
import {boundedJson} from "@/lib/api/bounded-body";

export async function POST(request:Request) {
  const gate=await adminOrDenyAll(["inventory.view","inventory.adjust"]);
  if("denied" in gate) return gate.denied;
  try {
    if(Number(request.headers.get("content-length") ?? 0)>4*1024*1024) throw new ApiError("VALIDATION","Revert request too large.");
    const body=await boundedJson(request,4*1024*1024);
    const result=await revertStockImport(body as RevertStockImportInput,gate.admin.user.id);
    return NextResponse.json(ok(result).body,{status:ok(result).status});
  } catch(error) { const result=fail(error); return NextResponse.json(result.body,{status:result.status}); }
}
