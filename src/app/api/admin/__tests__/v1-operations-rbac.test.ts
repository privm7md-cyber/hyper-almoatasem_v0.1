// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({permissions:[] as string[],signedIn:true,origin:"",stock:vi.fn(),parse:vi.fn(),assetPreview:vi.fn(),assetApply:vi.fn(),bulk:vi.fn()}));
vi.mock("next/headers",()=>({headers:async()=>new Headers({host:"localhost:3169",...(m.origin?{origin:m.origin}:{})})}));
vi.mock("@/lib/auth/rbac",()=>({checkPermission:async(p:string)=>!m.signedIn?{ok:false,code:"UNAUTHENTICATED"}:m.permissions.includes(p)?{ok:true,admin:{user:{id:"11111111-1111-4111-8111-111111111111"},permissions:m.permissions,roles:[]}}:{ok:false,code:"FORBIDDEN"},getCurrentAdmin:async()=>m.signedIn?{user:{id:"11111111-1111-4111-8111-111111111111"},permissions:m.permissions,roles:[]}:null}));
vi.mock("@/lib/inventory/import-service",()=>({previewOrApplyInventoryImport:m.stock}));
vi.mock("@/lib/inventory/import-file",()=>({MAX_IMPORT_BYTES:5*1024*1024,parseInventoryFile:m.parse}));
vi.mock("@/lib/catalog/media-review",()=>({previewProductAsset:m.assetPreview,applyProductAsset:m.assetApply}));
vi.mock("@/lib/db",()=>({prisma:{}}));
import {POST as stockRoute} from "@/app/api/admin/inventory/import/route";
import {POST as fileRoute} from "@/app/api/admin/inventory/import/file/route";
import {POST as mediaRoute} from "@/app/api/admin/catalog/media-review/route";
import {boundedJson} from "@/lib/api/bounded-body";
const body=()=>new Request("http://localhost:3169/api/admin/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dryRun:true})});
beforeEach(()=>{vi.clearAllMocks();m.permissions=[];m.signedIn=true;m.origin="";m.stock.mockResolvedValue({applied:false});});
describe("V1 import/media direct API authorization",()=>{
  it.each([["stock",stockRoute],["file",fileRoute],["media",mediaRoute]] as const)("%s rejects unauthenticated and unprivileged callers before body processing",async(_name,route)=>{
    m.signedIn=false;expect((await route(body())).status).toBe(401);m.signedIn=true;expect((await route(body())).status).toBe(403);
    expect(m.stock).not.toHaveBeenCalled();expect(m.parse).not.toHaveBeenCalled();expect(m.assetApply).not.toHaveBeenCalled();
  });
  it.each([['inventory.view'],['inventory.adjust']])("inventory requires both capabilities: %s",async p=>{m.permissions=[p];expect((await stockRoute(body())).status).toBe(403);expect((await fileRoute(body())).status).toBe(403);});
  it.each([['products.view'],['products.update']])("media requires both capabilities: %s",async p=>{m.permissions=[p];expect((await mediaRoute(body())).status).toBe(403);});
  it("a valid authorized import uses the session actor",async()=>{m.permissions=['inventory.view','inventory.adjust'];expect((await stockRoute(body())).status).toBe(200);expect(m.stock).toHaveBeenCalledWith({dryRun:true},"11111111-1111-4111-8111-111111111111");});
  it("cross-origin direct calls cannot reach an authorized write service",async()=>{m.permissions=['inventory.view','inventory.adjust','products.view','products.update'];m.origin='https://untrusted.example';expect((await stockRoute(body())).status).toBe(403);expect((await mediaRoute(body())).status).toBe(403);expect(m.stock).not.toHaveBeenCalled();});
  it("enforces the body limit even when content-length is absent",async()=>{const r=new Request('http://localhost',{method:'POST',body:'123456'});await expect(boundedJson(r,5)).rejects.toMatchObject({code:'VALIDATION'});});
});
