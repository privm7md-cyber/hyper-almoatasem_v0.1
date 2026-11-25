import {NextResponse} from "next/server";
import {adminOrDenyAll} from "@/lib/api/route-auth";
import {ApiError} from "@/lib/api/errors";
import {fail,ok} from "@/lib/api/respond";
import {previewProductAsset,applyProductAsset} from "@/lib/catalog/media-review";
import {boundedForm,boundedJson} from "@/lib/api/bounded-body";
export async function POST(request:Request) {
  const gate=await adminOrDenyAll(["products.view","products.update"]);if("denied" in gate)return gate.denied;
  try {
    let data;
    if(request.headers.get("content-type")?.includes("multipart/form-data")) {
      if(Number(request.headers.get("content-length") ?? 0)>11*1024*1024)throw new ApiError("VALIDATION","Image too large.");
      const form=await boundedForm(request,11*1024*1024),file=form.get("file");
      if(!(file instanceof File)||file.size>10*1024*1024)throw new ApiError("VALIDATION","Select an image up to 10 MB.");
      let input:unknown;try{input=JSON.parse(String(form.get("input")));}catch{throw new ApiError("VALIDATION","Invalid review data.");}
      data=await previewProductAsset(input,Buffer.from(await file.arrayBuffer()),gate.admin.user.id);
    }else data=await applyProductAsset(await boundedJson(request,8192),gate.admin.user.id);
    const r=ok(data);return NextResponse.json(r.body,{status:r.status});
  }catch(error){const r=fail(error);return NextResponse.json(r.body,{status:r.status});}
}
