import "server-only";
import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { ApiError } from "@/lib/api/errors";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_001;
export interface ImportFileTable { sheets:string[]; sheet:string; headers:string[]; rows:Array<{ row:number; cells:string[] }> }
const invalid = (message:string): never => { throw new ApiError("VALIDATION", message); };

/** RFC4180 quoting, embedded newlines, BOM and CRLF; never evaluate a cell. */
export function parseStockCsv(text:string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows:string[][] = []; let row:string[] = [], cell="", quoted=false, closed=false;
  const endCell=()=>{ row.push(cell); cell=""; closed=false; if(row.length>64) invalid("Maximum 64 columns."); };
  const endRow=()=>{ endCell(); rows.push(row); row=[]; if(rows.length>MAX_ROWS) invalid("Maximum 20,000 data rows."); };
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted) { if(ch==='"') { if(text[i+1]==='"'){cell+='"';i++;} else {quoted=false;closed=true;} } else cell+=ch; }
    else if(ch==='"') { if(cell || closed) invalid("Malformed CSV quoting."); quoted=true; }
    else if(ch===',') endCell();
    else if(ch==='\n' || ch==='\r') { if(ch==='\r' && text[i+1]==='\n') i++; endRow(); }
    else { if(closed) invalid("Unexpected data after CSV quote."); cell+=ch; }
    if(cell.length>2000) invalid("Cell exceeds 2,000 characters.");
  }
  if(quoted) invalid("Unclosed CSV quote.");
  if(cell || row.length || closed) endRow();
  return rows;
}

/** Bounded ZIP verification before ExcelJS allocates the workbook. ZIP64, macros,
 * external workbooks, encrypted content and dishonest expansion sizes are refused. */
function validateXlsxArchive(bytes:Buffer) {
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
  if(end<0) invalid("Invalid XLSX archive.");
  const count=bytes.readUInt16LE(end+10), offset=bytes.readUInt32LE(end+16);
  if(count>1000 || count===0 || offset>=end) invalid("XLSX archive limits exceeded.");
  let pos=offset,total=0;
  for(let n=0;n<count;n++) {
    if(pos+46>end || bytes.readUInt32LE(pos)!==0x02014b50) invalid("Invalid XLSX directory.");
    const flags=bytes.readUInt16LE(pos+8), method=bytes.readUInt16LE(pos+10), compressed=bytes.readUInt32LE(pos+20), expanded=bytes.readUInt32LE(pos+24);
    const nameLength=bytes.readUInt16LE(pos+28), extra=bytes.readUInt16LE(pos+30), comment=bytes.readUInt16LE(pos+32), local=bytes.readUInt32LE(pos+42);
    const name=bytes.subarray(pos+46,pos+46+nameLength).toString();
    total+=expanded;
    if((flags&1) || ![0,8].includes(method) || total>32*1024*1024 || expanded>16*1024*1024 || /vbaProject|externalLinks/i.test(name)) invalid("Unsupported or oversized XLSX content.");
    if(local+30>offset || bytes.readUInt32LE(local)!==0x04034b50) invalid("Invalid XLSX entry.");
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(start+compressed>offset) invalid("Invalid XLSX entry length.");
    const input=bytes.subarray(start,start+compressed);
    const output=method===0 ? input : inflateRawSync(input,{maxOutputLength:16*1024*1024});
    if(output.length!==expanded) invalid("Invalid XLSX expansion size.");
    pos+=46+nameLength+extra+comment;
  }
}

export async function parseInventoryFile(bytes:Buffer, filename:string, sheetName?:string):Promise<ImportFileTable> {
  if(bytes.length===0 || bytes.length>MAX_IMPORT_BYTES) invalid("File must be 1 byte to 5 MB.");
  let grid:string[][]; let sheets:string[]; let sheet:string;
  if(/\.csv$/i.test(filename)) {
    let text:string;
    try { text=new TextDecoder("utf-8",{fatal:true}).decode(bytes); } catch { return invalid("CSV must be UTF-8 (Excel CSV UTF-8)."); }
    grid=parseStockCsv(text); sheets=["CSV"]; sheet="CSV";
  } else if(/\.xlsx$/i.test(filename)) {
    try { validateXlsxArchive(bytes); } catch(e) { if(e instanceof ApiError) throw e; return invalid("Invalid or oversized XLSX archive."); }
    const workbook=new ExcelJS.Workbook();
    try { await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]); } catch { return invalid("Cannot read XLSX workbook."); }
    sheets=workbook.worksheets.filter(s=>s.actualRowCount>0).map(s=>s.name);
    const ws=sheetName ? workbook.getWorksheet(sheetName) : workbook.getWorksheet(sheets[0]);
    const rowCount=ws?.rowCount ?? 0,columnCount=ws?.columnCount ?? 0;
    if(!ws || rowCount>MAX_ROWS || columnCount>64) invalid("Select a worksheet with up to 20,000 rows and 64 columns.");
    sheet=ws!.name; grid=[];
    for(let r=1;r<=rowCount;r++) {
      const cells:string[]=[];
      for(let c=1;c<=columnCount;c++) {
        const cell=ws!.getCell(r,c), value=cell.value;
        if(cell.isMerged || (value!==null && typeof value!=="string" && typeof value!=="number")) cells.push("#UNSUPPORTED_CELL");
        else if(typeof value==="number" && (!Number.isFinite(value) || Math.abs(value)>=1e15)) cells.push("#UNSAFE_NUMBER");
        else cells.push(String(value ?? ""));
        if(cells[c-1].length>2000) invalid("Cell exceeds 2,000 characters.");
      }
      grid.push(cells);
    }
  } else return invalid("Only CSV UTF-8 and XLSX files are supported; export legacy XLS first.");
  if(grid.length<2) invalid("A header and at least one data row are required.");
  const width=Math.max(...grid.map(r=>r.length));
  const headers=Array.from({length:width},(_,i)=>`${i+1}: ${grid[0][i]?.trim() || "(blank)"}`);
  const rows=grid.slice(1).map((cells,i)=>({row:i+2,cells})).filter(r=>r.cells.some(c=>c.trim()!==""));
  if(!rows.length) invalid("No data rows found.");
  return {sheets,sheet,headers,rows};
}
