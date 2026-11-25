// Real historical files are parsed and compared read-only. They are not stock authorization.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import dotenv from 'dotenv';
import {Client} from 'pg';
registerHooks({resolve(s,c,next){if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);return next(s,c);}});
const {parseInventoryFile}=await import('../src/lib/inventory/import-file.ts');
const sources=['D:/عر بيع قطاعي.xlsx','D:/سعر بيع وشراء.xlsx','D:/بدون اسعار.xlsx','D:/المصنف1.xlsx'];
const local={...dotenv.parse(fs.readFileSync('.env')),...dotenv.parse(fs.readFileSync('.env.local'))},url=new URL(local.DATABASE_URL);
if(url.pathname!=='/hyper_almoatasem'||!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Read-only Primary guard');
url.searchParams.set('options','-c default_transaction_read_only=on');
const c=new Client({connectionString:url.toString()});await c.connect();await c.query('BEGIN READ ONLY');
try{
 const prices=new Map((await c.query('SELECT c.code,v.price::text,p.is_active,p.deleted_at FROM product_codes c JOIN product_variants v ON v.id=c.product_variant_id JOIN products p ON p.id=v.product_id')).rows.map(r=>[r.code,r]));
 const results=[],tables=[];
 for(const file of sources){
  if(!fs.existsSync(file)){results.push({file,available:false});continue;}
  const bytes=fs.readFileSync(file),t=await parseInventoryFile(bytes,path.basename(file));tables.push(t);
  const headers=t.headers.map(h=>h.replace(/^\d+: /,'')),code=headers.indexOf('الكود'),stock=headers.indexOf('رصيد حالي'),sell=headers.indexOf('سعر البيع'),sector=headers.indexOf('سعر بيع قطاعي');
  const data=t.rows.filter(r=>r.cells[code]?.trim()),seen=new Map();for(const r of data)seen.set(r.cells[code],(seen.get(r.cells[code])??0)+1);
  results.push({file,available:true,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,sheet:t.sheet,headers,nonemptyRows:t.rows.length,codeRows:data.length,residualRows:t.rows.length-data.length,duplicateCodes:[...seen.values()].filter(n=>n>1).length,negativeStock:stock<0?null:data.filter(r=>Number(r.cells[stock])<0).length,unknownStock:stock<0?null:data.filter(r=>!r.cells[stock]?.trim()).length,matchedCodes:data.filter(r=>prices.has(r.cells[code])).length,unmatchedCodes:data.filter(r=>!prices.has(r.cells[code])).length,priceConflicts:(sell<0&&sector<0)?null:data.filter(r=>prices.has(r.cells[code])&&Number(r.cells[sell<0?sector:sell])!==Number(prices.get(r.cells[code]).price)).length});
 }
 let differingPriceLists=null;
 const cols=t=>t.headers.map(h=>h.replace(/^\d+: /,'')),a=tables.find(t=>cols(t).includes('سعر بيع قطاعي')),b=tables.find(t=>cols(t).includes('سعر البيع'));
 if(a&&b){const ac=cols(a),bc=cols(b),map=new Map(a.rows.map(r=>[r.cells[ac.indexOf('الكود')],r.cells[ac.indexOf('سعر بيع قطاعي')]]));differingPriceLists=b.rows.filter(r=>r.cells[bc.indexOf('الكود')]&&map.has(r.cells[bc.indexOf('الكود')])&&Number(map.get(r.cells[bc.indexOf('الكود')]))!==Number(r.cells[bc.indexOf('سعر البيع')])).length;}
 fs.writeFileSync('_recovery/v1-ops/evidence/pos-sources.json',JSON.stringify({capturedAt:new Date().toISOString(),mode:'READ ONLY',historicalInputsNotApprovedCurrentStock:true,differingPriceLists,results},null,2));console.log(JSON.stringify({files:results.length,differingPriceLists,negativeStock:results.map(r=>r.negativeStock),writes:0}));
 await c.query('COMMIT');
}finally{await c.end();}
