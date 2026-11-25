import fs from "node:fs/promises";
import {prisma} from "@/lib/db";
import {productAssetPath} from "@/lib/catalog/media-review";
export async function GET(_request:Request,{params}:{params:Promise<{digest:string}>}) {
  const {digest}=await params;
  if(!/^[a-f0-9]{64}$/.test(digest))return new Response(null,{status:404});
  const image=await prisma.productImage.findFirst({where:{url:`/api/store/product-assets/${digest}`,product:{isActive:true,deletedAt:null}},select:{id:true}});
  if(!image)return new Response(null,{status:404}); // staged/orphan files are never published
  try{const data=await fs.readFile(productAssetPath(digest));return new Response(data,{headers:{"Content-Type":"image/webp","X-Content-Type-Options":"nosniff","Cache-Control":"public, max-age=300"}});}catch{return new Response(null,{status:404});}
}
