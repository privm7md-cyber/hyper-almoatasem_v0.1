import {ApiError} from "@/lib/api/errors";
export async function boundedBody(request:Request,maximum:number):Promise<Buffer> {
  if(Number(request.headers.get("content-length") ?? 0)>maximum)throw new ApiError("VALIDATION","Upload exceeds the size limit.");
  if(!request.body)throw new ApiError("VALIDATION","Request body required.");
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();throw new ApiError("VALIDATION","Upload exceeds the size limit.");}chunks.push(value);}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks,size);
}
export async function boundedJson(request:Request,maximum:number):Promise<unknown>{
  const bytes=await boundedBody(request,maximum);try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new ApiError("VALIDATION","Invalid JSON body.");}
}
export async function boundedForm(request:Request,maximum:number):Promise<FormData>{
  const bytes=await boundedBody(request,maximum);try{return await new Response(new Uint8Array(bytes),{headers:{"content-type":request.headers.get("content-type") ?? ""}}).formData();}catch{throw new ApiError("VALIDATION","Invalid multipart body.");}
}
