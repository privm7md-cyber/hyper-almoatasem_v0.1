// @vitest-environment node
import {describe,it,expect,vi,afterEach} from "vitest";
import ExcelJS from "exceljs";
import {parseInventoryFile,parseStockCsv} from "../import-file";
import {inventoryDifferences,differencesCsv,stockImportSchema,type ImportTarget,type StockImportRow} from "../import-validation";
import {signOperationPreview,verifyOperationPreview} from "@/lib/admin/operation-preview";
const target:ImportTarget={id:"v1",productId:"p1",name:"عبوة 500 جم",codes:["00123","PACK"],active:true,productType:"PIECE",sizeUnit:"GRAM",quantity:null,reserved:"0.000",revision:null,price:"12.50"};
const row=(overrides:Partial<StockImportRow>={}):StockImportRow=>({row:2,code:"00123",productCode:"",quantity:"0",unit:"PIECE",sourcePrice:"",...overrides});
afterEach(()=>vi.unstubAllEnvs());
describe("inventory import validation",()=>{
  it("keeps packaged grams as whole PIECE balances and distinguishes zero from unknown",()=>{
    expect(inventoryDifferences([row()], [target])[0]).toMatchObject({status:"accepted",before:null,after:"0.000",delta:null});
    expect(inventoryDifferences([row({quantity:""})],[target])[0].errors).toContain("UNKNOWN_STOCK");
  });
  it.each([["-1","NEGATIVE_STOCK"],["1.0001","INVALID_QUANTITY"],["1000000000","INVALID_QUANTITY"],["1e3","INVALID_QUANTITY"],["0.125","FRACTIONAL_PIECES"],["=1+1","INVALID_QUANTITY"]])("rejects %s as %s",(quantity,error)=>expect(inventoryDifferences([row({quantity})],[target])[0].errors).toContain(error));
  it("preserves leading zeros; no name/fuzzy matching",()=>expect(inventoryDifferences([row({code:"123"})],[target])[0].errors).toContain("PRODUCT_NOT_FOUND"));
  it("rejects missing/ambiguous codes",()=>{
    expect(inventoryDifferences([row({code:""})],[target])[0].errors).toContain("MISSING_CODE");
    expect(inventoryDifferences([row({productCode:"B"})],[target,{...target,id:"v2",codes:["B"]}])[0].errors).toContain("AMBIGUOUS_PRODUCT");
    expect(inventoryDifferences([row()],[target,{...target,id:"v2"}])[0].errors).toContain("AMBIGUOUS_PRODUCT");
  });
  it("rejects all aliases for a duplicated variant, not just the later row",()=>{
    const result=inventoryDifferences([row(),row({row:3,code:"PACK"})],[target]);
    expect(result.every(r=>r.status==="rejected" && r.errors.includes("DUPLICATE_VARIANT"))).toBe(true);
  });
  it("requires explicit units and protects reservations and archived products",()=>{
    expect(inventoryDifferences([row({unit:"GRAM"})],[target])[0].errors).toContain("UNIT_MISMATCH");
    expect(inventoryDifferences([row()],[{...target,quantity:"3.000",reserved:"1.000"}])[0].errors).toContain("BELOW_RESERVED_STOCK");
    expect(inventoryDifferences([row()],[{...target,active:false}])[0].errors).toContain("INACTIVE_OR_ARCHIVED");
  });
  it("accepts weighed physical facts without imposing sale steps, never infers missing units",()=>{
    expect(inventoryDifferences([row({unit:"KG",quantity:"0.475"})],[{...target,productType:"WEIGHT",sizeUnit:"KG"}])[0].status).toBe("accepted");
    expect(inventoryDifferences([row({unit:"KG"})],[{...target,productType:"WEIGHT",sizeUnit:null}])[0].errors).toContain("UNRESOLVED_STOCK_UNIT");
  });
  it("reports exact differences without changing source prices",()=>{
    expect(inventoryDifferences([row({quantity:"12",sourcePrice:"99"})],[{...target,quantity:"10.000"}])[0]).toMatchObject({delta:"2.000",warnings:["PRICE_CONFLICT_REVIEW_ONLY"],status:"accepted"});
  });
  it("escapes CSV error cells and protects exported formula prefixes",()=>{
    const result=inventoryDifferences([row({code:'=HYPERLINK("x")'})],[]);
    expect(differencesCsv(result)).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it("rejects duplicate source row numbers and unrecognized location scope",()=>{
    const base={source:"fixture",asOf:"2026-01-01T00:00:00Z",location:"GLOBAL",reason:"test",rows:[row(),row()]};
    expect(stockImportSchema.safeParse(base).success).toBe(false);
    expect(stockImportSchema.safeParse({...base,location:"BRANCH",rows:[row()]}).success).toBe(false);
  });
});
describe("CSV and Excel boundary",()=>{
  it("reads BOM, quoted commas, escaped quotes and embedded line breaks",()=>expect(parseStockCsv('\uFEFFcode,name\r\n00123,"a,\n""b"""\r\n')).toEqual([["code","name"],["00123",'a,\n"b"']]));
  it.each(['x\n"bad','x\na"b','x\n"a"oops'])('rejects malformed quoting %s',text=>expect(()=>parseStockCsv(text)).toThrow());
  it("preserves source row numbering including partially empty POS rows",async()=>{
    const t=await parseInventoryFile(Buffer.from('code,stock,store\n,,store\n00123,0,store\n,,\n'),"stock.csv");
    expect(t.rows.map(r=>r.row)).toEqual([2,3]);expect(t.rows[1].cells[0]).toBe("00123");
  });
  it("reads XLSX exact identifiers, sheets, zero and refuses formula/unsafe cells",async()=>{
    const w=new ExcelJS.Workbook(),s=w.addWorksheet("POS");s.addRow(["code","stock"]);s.addRow(["00123",0]);s.addRow(["PACK",{formula:"1+2",result:3}]);s.addRow([1e17,4]);w.addWorksheet("Empty");
    const t=await parseInventoryFile(Buffer.from(await w.xlsx.writeBuffer()),"stock.xlsx");
    expect(t.sheets).toEqual(["POS"]);expect(t.rows[0].cells).toEqual(["00123","0"]);expect(t.rows[1].cells[1]).toBe("#UNSUPPORTED_CELL");expect(t.rows[2].cells[0]).toBe("#UNSAFE_NUMBER");
  });
  it("rejects legacy XLS, damaged ZIP and invalid UTF8",async()=>{
    await expect(parseInventoryFile(Buffer.from("bad"),"x.xls")).rejects.toThrow();
    await expect(parseInventoryFile(Buffer.from("bad"),"x.xlsx")).rejects.toThrow();
    await expect(parseInventoryFile(Buffer.from([0xff]),"x.csv")).rejects.toThrow();
  });
});
describe("authorized preview receipts",()=>{
  it("binds actor, operation, content, and expiry; rejects tampering",()=>{
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET","synthetic-preview-test-secret-0000000000000000");
    const receipt=signOperationPreview("stock","actor",{stock:1});
    expect(()=>verifyOperationPreview(receipt,"stock","actor",{stock:1})).not.toThrow();
    expect(()=>verifyOperationPreview(receipt,"stock","other",{stock:1})).toThrow();
    expect(()=>verifyOperationPreview(receipt,"bulk","actor",{stock:1})).toThrow();
    expect(()=>verifyOperationPreview(receipt,"stock","actor",{stock:2})).toThrow();
    expect(()=>verifyOperationPreview(receipt+"x","stock","actor",{stock:1})).toThrow();
    vi.spyOn(Date,"now").mockReturnValue(Date.now()+601_000);
    expect(()=>verifyOperationPreview(receipt,"stock","actor",{stock:1})).toThrow();vi.restoreAllMocks();
  });
});
