import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {z} from "zod";
import {prisma} from "@/lib/db";
import {ApiError,conflict} from "@/lib/api/errors";
import {auditInTx} from "@/lib/api/audit";
import {assertAdminPreviewWritesAllowed} from "@/lib/auth/admin-read-only-preview";
import {signOperationPreview,verifyOperationPreview} from "@/lib/admin/operation-preview";

export const assetReviewSchema=z.object({code:z.string().trim().max(64),productCode:z.string().trim().max(64).default(""),productId:z.string().uuid().optional(),source:z.string().trim().min(3).max(300),authorized:z.literal(true),altText:z.string().trim().min(1).max(200)}).strict();
const applySchema=assetReviewSchema.extend({digest:z.string().regex(/^[a-f0-9]{64}$/),previewReceipt:z.string().max(2048),confirmed:z.literal(true)}).strict();
export function productAssetPath(digest:string):string {
  if(!/^[a-f0-9]{64}$/.test(digest))throw new ApiError("VALIDATION","Invalid image identifier.");
  return path.join(process.env.PRODUCT_ASSET_DIR || path.join(process.cwd(),".product-assets"),`${digest}.webp`);
}
export async function validateProductImage(bytes:Buffer) {
  if(!bytes.length||bytes.length>10*1024*1024)throw new ApiError("VALIDATION","Image must be at most 10 MB.");
  try{
    const img=sharp(bytes,{limitInputPixels:25_000_000,animated:false,failOn:"warning"}),meta=await img.metadata();
    if(!["jpeg","png","webp"].includes(meta.format ?? "") || (meta.pages ?? 1)>1 || !meta.width || !meta.height || meta.width<100 || meta.height<100 || meta.width>5000 || meta.height>5000)throw Error("Unsupported image");
    // Decode and re-encode strips EXIF and trailing payloads; never trusts MIME/name.
    const result=await img.rotate().webp({quality:90}).toBuffer({resolveWithObject:true});
    const digest=createHash("sha256").update(result.data).digest("hex");
    return {bytes:result.data,digest,width:result.info.width,height:result.info.height,byteSize:result.data.length,mimeType:"image/webp"};
  }catch{throw new ApiError("VALIDATION","Use a valid, single-frame JPEG, PNG or WebP, 100–5000 pixels per side.");}
}
async function candidates(input:z.infer<typeof assetReviewSchema>,db=prisma) {
  const codes=[input.code,input.productCode].filter(Boolean);
  if(!codes.length)throw new ApiError("VALIDATION","An exact product code is required.");
  const matches=await db.productCode.findMany({where:{code:{in:codes}},select:{code:true,variant:{select:{product:{select:{id:true,name:true,isActive:true,deletedAt:true}}}}}});
  const products=[...new Map(matches.map(m=>[m.variant.product.id,m.variant.product])).values()];
  const complete=codes.every(code=>matches.some(m=>m.code===code));
  return {products,complete};
}
export async function previewProductAsset(raw:unknown,bytes:Buffer,actor:string) {
  assertAdminPreviewWritesAllowed(); // staging is a filesystem write
  const parsed=assetReviewSchema.safeParse(raw);if(!parsed.success)throw new ApiError("VALIDATION","Declare the authorized image source, code and alternative text.");
  const input=parsed.data,{products,complete}=await candidates(input);
  const product=complete ? products.find(p=>input.productId ? p.id===input.productId : products.length===1) : undefined;
  if(!product)return {candidates:products.map(p=>({id:p.id,name:p.name})),needsReview:true as const,previewReceipt:null};
  if(product.deletedAt)throw conflict("Archived products require an owner decision before imagery changes.");
  const asset=await validateProductImage(bytes),url=`/api/store/product-assets/${asset.digest}`;
  const duplicates=await prisma.productImage.findMany({where:{url},select:{id:true,productId:true}});
  // Reusing identical bytes on a second SKU can be a mismatched pack/variant.
  // Require a distinct reviewed source asset instead of silently attaching it.
  if(duplicates.length)throw conflict("This image is already registered. Review the existing product image.",{products:duplicates.map(d=>d.productId)});
  const gallery=await prisma.productImage.findMany({where:{productId:product.id},orderBy:{id:"asc"},select:{id:true,url:true,isPrimary:true}});
  const file=productAssetPath(asset.digest);await fs.mkdir(path.dirname(file),{recursive:true});
  try{await fs.writeFile(file,asset.bytes,{flag:"wx"});}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}
  const metadata={digest:asset.digest,url,width:asset.width,height:asset.height,byteSize:asset.byteSize,mimeType:asset.mimeType};
  const terms={...input,productId:product.id};
  return {candidates:[{id:product.id,name:product.name}],needsReview:false as const,metadata,
    previewReceipt:signOperationPreview("product-asset",actor,{terms,metadata,gallery}),terms};
}
export async function applyProductAsset(raw:unknown,actor:string) {
  assertAdminPreviewWritesAllowed();
  const parsed=applySchema.safeParse(raw);if(!parsed.success || !parsed.data.productId)throw new ApiError("VALIDATION","Review and confirmation are required.");
  const {digest,previewReceipt,confirmed:_,...terms}=parsed.data;void _;
  const bytes=await fs.readFile(productAssetPath(digest)).catch(()=>{throw conflict("Staged image is unavailable; upload again.");});
  if(createHash("sha256").update(bytes).digest("hex")!==digest)throw conflict("Image bytes changed; upload again.");
  const info=await sharp(bytes).metadata();
  const metadata={digest,url:`/api/store/product-assets/${digest}`,width:info.width!,height:info.height!,byteSize:bytes.length,mimeType:"image/webp"};
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(712019,2)::text`;
    await tx.$queryRaw`SELECT id FROM products WHERE id=${terms.productId}::uuid FOR UPDATE`;
    const {products,complete}=await candidates(terms,tx as typeof prisma);
    const product=products.find(p=>p.id===terms.productId);
    if(!complete||!product||product.deletedAt)throw conflict("Product matching changed; review again.");
    const gallery=await tx.productImage.findMany({where:{productId:terms.productId},orderBy:{id:"asc"},select:{id:true,url:true,isPrimary:true}});
    verifyOperationPreview(previewReceipt,"product-asset",actor,{terms,metadata,gallery});
    if(await tx.productImage.count({where:{url:metadata.url}}))throw conflict("Image already registered.");
    const image=await tx.productImage.create({data:{productId:terms.productId!,url:metadata.url,width:metadata.width,height:metadata.height,byteSize:metadata.byteSize,mimeType:metadata.mimeType,altText:terms.altText,isPrimary:false}});
    await auditInTx(tx,{action:"product_images.create",userId:actor,entityType:"product_images",entityId:image.id,oldValues:null,
      newValues:{productId:terms.productId,...metadata,source:terms.source,authorized:true,altText:terms.altText},reason:"Reviewed authorized product asset"});
    return {id:image.id,url:image.url,productId:image.productId};
  });
}
