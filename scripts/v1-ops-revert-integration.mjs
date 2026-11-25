// Revert (rollback) integration tests — disposable DB (hyper_v1_ops_disposable, port 55449).
// Run: node scripts/v1-ops-isolated.mjs run scripts/v1-ops-revert-integration.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s==='next/headers')return next('next/headers.js',c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
import { Client } from "pg";
const dba=new Client({connectionString:process.env.V1_OPS_DATABASE_URL});await dba.connect();
const identity=(await dba.query("SELECT current_database() db,inet_server_port() port")).rows[0];
assert.equal(identity.db,'hyper_v1_ops_disposable');assert.equal(identity.port,55449);
const {prisma}=await import('../src/lib/db.ts');
const {previewOrApplyInventoryImport:stock}=await import('../src/lib/inventory/import-service.ts');
const {revertStockImport}=await import('../src/lib/inventory/revert-service.ts');
const admin=process.env.V1_OPS_ADMIN_ID, tag=randomUUID().slice(0,8), category=randomUUID(), variantA=randomUUID(), variantB=randomUUID();
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
const quantityText=async id=>(await dba.query('SELECT quantity::text q FROM inventory WHERE product_variant_id=$1',[id])).rows[0]?.q ?? null;
const row=(id,quantity,unit,r=2)=>({row:r,code:id,productCode:'',quantity,unit,sourcePrice:''});
const input=(rows)=>({source:'synthetic-revert-'+randomUUID(),asOf:'2026-01-01T00:00:00Z',location:'GLOBAL',reason:'Revert acceptance',rows,dryRun:true});
async function previewApply(i){const p=await stock(i,admin);return stock({...i,dryRun:false,confirmed:true,previewReceipt:p.previewReceipt},admin);}
await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$2)",[category,'cat-'+tag]);
await dba.query("INSERT INTO products(id,name,slug,category_id,product_type,unit,sale_step_grams) VALUES($1,$2,$2,$3,'PIECE','PIECE',null),($4,$5,$5,$3,'PIECE','PIECE',null)",[variantA,'reva-'+tag,category,variantB,'revb-'+tag]);
await dba.query("INSERT INTO product_variants(id,product_id,name,size_value,size_unit,price) VALUES($1,(SELECT id FROM products WHERE name=$2 AND id=$1),'',500,'GRAM',10),($3,(SELECT id FROM products WHERE name=$4 AND id=$3),'',500,'GRAM',20)",[variantA,'reva-'+tag,variantB,'revb-'+tag]);
await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'INTERNAL_CODE'),($3,$4,'INTERNAL_CODE')",[variantA,'rev-a-'+tag,variantB,'rev-b-'+tag]);
await dba.query('INSERT INTO inventory(product_variant_id,quantity,reserved_quantity) VALUES($1,$2,0)',[variantA,'3.000']);
try {
  await test('revert of an adjusted import restores the pre-import balance', async () => {
    const r = await previewApply(input([row('rev-a-'+tag, '5.000', 'PIECE')]));
    assert.equal(await quantityText(variantA), '5.000');
    const pv = await revertStockImport({importId: r.importId, dryRun: true}, admin);
    assert.deepEqual(pv.summary, {total:1, planned:1, reverted:0});
    assert.equal(pv.diffs[0].delta, '-2.000');
    assert.equal(await quantityText(variantA), '5.000'); // dry-run writes nothing
    const apply = await revertStockImport({importId: r.importId, dryRun: false, confirmed: true}, admin);
    assert.equal(apply.summary.reverted, 1);
    assert.equal(await quantityText(variantA), '3.000');
    const again = await revertStockImport({importId: r.importId, dryRun: true}, admin);
    assert.equal(again.summary.planned, 0); // second revert is a no-op
  });
  await test('revert of an import-created opening balance returns it to neutral zero', async () => {
    const r = await previewApply(input([row('rev-b-'+tag, '2.000', 'PIECE')]));
    assert.equal(await quantityText(variantB), '2.000');
    const apply = await revertStockImport({importId: r.importId, dryRun: false, confirmed: true}, admin);
    assert.equal(apply.summary.reverted, 1);
    assert.equal(await quantityText(variantB), '0.000');
  });
  await test('revert requires confirmation, is audited, and 404s on unknown imports', async () => {
    const r = await previewApply(input([row('rev-a-'+tag, '4.000', 'PIECE')]));
    await assert.rejects(revertStockImport({importId: r.importId, dryRun: false}, admin), /Explicit confirmation/);
    const app = await revertStockImport({importId: r.importId, dryRun: false, confirmed: true}, admin);
    assert.equal(app.summary.reverted, 1);
    assert.equal(await quantityText(variantA), '3.000');
    assert.ok((await dba.query("SELECT count(*)::int n FROM audit_logs WHERE action='inventory.revert_row' AND old_values->>'quantity'='4.000'")).rows[0].n >= 1);
    await assert.rejects(revertStockImport({importId: randomUUID(), dryRun: true}, admin), /No stock import/);
  });
  await test('two racing reverts have at most one winner; final balance is stable', async () => {
    const r = await previewApply(input([row('rev-a-'+tag, '6.000', 'PIECE')]));
    assert.equal(await quantityText(variantA), '6.000');
    const rv = Promise.allSettled([
      revertStockImport({importId: r.importId, dryRun: false, confirmed: true}, admin),
      revertStockImport({importId: r.importId, dryRun: false, confirmed: true}, admin),
    ]);
    const rvOut = await rv;
    assert.ok(rvOut.filter(v=>v.status==='fulfilled').length >= 1);
    assert.ok(rvOut.filter(v=>v.status==='rejected').length <= 1);
    assert.equal(await quantityText(variantA), '3.000');
  });
} finally {
  await prisma.$disconnect(); await dba.end();
  fs.writeFileSync('_recovery/v1-ops/evidence/postgres-revert.json', JSON.stringify({identity, total: results.length, failed: results.filter(r=>!r.pass).length, results}, null, 2));
  process.exitCode = results.some(r=>!r.pass) ? 1 : 0;
}
