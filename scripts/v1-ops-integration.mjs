import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Client} from 'pg';
import { assertDisposableConnection, assertDisposableEnvironment } from './lib/disposable-db-guard.mjs';
registerHooks({resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s==='next/headers')return next('next/headers.js',c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
assertDisposableEnvironment({ context: "v1-ops-integration", requireKeys: ["DATABASE_URL", "V1_OPS_DATABASE_URL"] });
const dba=new Client({connectionString:process.env.V1_OPS_DATABASE_URL});await dba.connect();
await assertDisposableConnection(dba, { context: "v1-ops-integration" });
const identity=(await dba.query("SELECT current_database() db,inet_server_port() port,current_setting('data_directory') directory")).rows[0];
assert.equal(identity.db,'hyper_v1_ops_disposable');assert.equal(identity.port,55449);assert.equal(path.resolve(identity.directory),path.resolve('_recovery/v1-ops/pgdata'));
const {prisma}=await import('../src/lib/db.ts');
const {previewOrApplyInventoryImport:stock}=await import('../src/lib/inventory/import-service.ts');
const {createDeliveryZone,updateDeliveryZone}=await import('../src/lib/admin/delivery-zones.ts');
const {resolveDeliveryQuote}=await import('../src/lib/orders/delivery-fee.ts');
const admin=process.env.V1_OPS_ADMIN_ID,tag=randomUUID().slice(0,8),category=randomUUID(),p1=randomUUID(),p2=randomUUID(),v1=randomUUID(),v2=randomUUID();
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
const quantity=async id=>(await dba.query('SELECT quantity::text,reserved_quantity::text FROM inventory WHERE product_variant_id=$1',[id])).rows[0];
await dba.query('INSERT INTO categories(id,name,slug) VALUES($1,$2,$2)',[category,'synthetic-'+tag]);
await dba.query("INSERT INTO products(id,name,slug,category_id,product_type,unit,sale_step_grams) VALUES($1,'عبوة تجريبية 500 جم',$3,$4,'PIECE','PIECE',null),($2,'وزن تجريبي',$5,$4,'WEIGHT','KG',125)",[p1,p2,'piece-'+tag,category,'weight-'+tag]);
await dba.query("INSERT INTO product_variants(id,product_id,name,size_value,size_unit,price) VALUES($1,$2,'synthetic',500,'GRAM',12.50),($3,$4,'synthetic',1,'KG',50.00)",[v1,p1,v2,p2]);
await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'INTERNAL_CODE'),($3,$4,'INTERNAL_CODE')",[v1,'piece-'+tag,v2,'weight-'+tag]);
const row=(id,quantity,unit,r=2)=>({row:r,code:id==='piece'?'piece-'+tag:'weight-'+tag,productCode:'',quantity,unit,sourcePrice:''});
const input=(rows)=>({source:'synthetic-'+randomUUID(),asOf:'2026-01-01T00:00:00Z',location:'GLOBAL',reason:'Synthetic isolation acceptance',rows,dryRun:true});
async function previewApply(i){const p=await stock(i,admin);return stock({...i,dryRun:false,confirmed:true,previewReceipt:p.previewReceipt},admin);}
try {
  await test('preview is read-only and exact accepted/rejected counts',async()=>{
    const p=await stock(input([row('piece','0','PIECE'),row('weight','-1','KG',3)]),admin);
    assert.deepEqual(p.summary,{total:2,accepted:1,rejected:1,created:1,changed:0,unchanged:0});assert.equal(await quantity(v1),undefined);
  });
  await test('explicit confirmation and a server preview are both mandatory',async()=>{
    const i=input([row('piece','2','PIECE')]);await assert.rejects(stock({...i,dryRun:false},admin),/confirmation/i);await assert.rejects(stock({...i,dryRun:false,confirmed:true},admin),/preview/i);assert.equal(await quantity(v1),undefined);
  });
  await test('known zero opens stock and a rejected row cannot create stock',async()=>{
    const r=await previewApply(input([row('piece','0','PIECE'),row('weight','','KG',3)]));assert.equal(r.summary.accepted,1);assert.equal((await quantity(v1)).quantity,'0.000');assert.equal(await quantity(v2),undefined);
    assert.equal((await dba.query('SELECT count(*)::int n FROM inventory_movements WHERE product_variant_id=$1',[v1])).rows[0].n,0);
  });
  await test('weighed facts keep exact thousandths and no price overwrite',async()=>{
    await previewApply(input([{...row('weight','0.475','KG'),sourcePrice:'999.00'}]));assert.equal((await quantity(v2)).quantity,'0.475');assert.equal((await dba.query('SELECT price::text FROM product_variants WHERE id=$1',[v2])).rows[0].price,'50.00');
  });
  await test('atomic adjustment produces exact movement and audit pairing',async()=>{
    const r=await previewApply(input([row('piece','5','PIECE')]));assert.equal((await quantity(v1)).quantity,'5.000');
    const m=(await dba.query('SELECT quantity::text,previous_quantity::text,new_quantity::text FROM inventory_movements WHERE reference_id=$1',[r.importId])).rows;assert.deepEqual(m,[{quantity:'5.000',previous_quantity:'0.000',new_quantity:'5.000'}]);
    assert.equal((await dba.query("SELECT count(*)::int n FROM audit_logs WHERE action='inventory.import' AND entity_id=$1",[r.importId])).rows[0].n,1);
  });
  await test('replay / parallel duplicate import has exactly one winner',async()=>{
    const i=input([row('piece','6','PIECE')]),p=await stock(i,admin),apply={...i,dryRun:false,confirmed:true,previewReceipt:p.previewReceipt};
    const r=await Promise.allSettled([stock(apply,admin),stock(apply,admin)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(r.filter(v=>v.status==='rejected').length,1);
    await assert.rejects(stock(i,admin),/already imported/i);assert.equal((await quantity(v1)).quantity,'6.000');
  });
  await test('a reservation after preview invalidates the entire import',async()=>{
    const i=input([row('piece','7','PIECE'),row('weight','0.500','KG',3)]),p=await stock(i,admin);
    await dba.query('UPDATE inventory SET reserved_quantity=1 WHERE product_variant_id=$1',[v1]);
    await assert.rejects(stock({...i,dryRun:false,confirmed:true,previewReceipt:p.previewReceipt},admin),/changed/i);
    assert.equal((await quantity(v2)).quantity,'0.475');await dba.query('UPDATE inventory SET reserved_quantity=0 WHERE product_variant_id=$1',[v1]);
  });
  await test('two distinct previews of the same balance have one winner',async()=>{
    const a=input([row('piece','8','PIECE')]),b=input([row('piece','9','PIECE')]),pa=await stock(a,admin),pb=await stock(b,admin);
    const r=await Promise.allSettled([stock({...a,dryRun:false,confirmed:true,previewReceipt:pa.previewReceipt},admin),stock({...b,dryRun:false,confirmed:true,previewReceipt:pb.previewReceipt},admin)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);
  });
  await test('audit failure rolls back all stock rows and movements',async()=>{
    const before1=await quantity(v1),before2=await quantity(v2),i=input([row('piece','11','PIECE'),row('weight','1.123','KG',3)]),p=await stock(i,admin);
    await dba.query("CREATE FUNCTION v1_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='inventory.import' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER v1_test_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION v1_test_fail_audit()");
    try{await assert.rejects(stock({...i,dryRun:false,confirmed:true,previewReceipt:p.previewReceipt},admin));assert.deepEqual(await quantity(v1),before1);assert.deepEqual(await quantity(v2),before2);}
    finally{await dba.query('DROP TRIGGER v1_test_audit_fault ON audit_logs; DROP FUNCTION v1_test_fail_audit()');}
  });
  let zone;
  await test('delivery zone city scope prevents same-name cross-city eligibility',async()=>{
    zone=await createDeliveryZone({name:'قرية '+tag,fee:'7.25',scope:{city:'مركز تجريبي',locality:'قرية '+tag,field:'village',eligible:true}},admin);
    const valid=await resolveDeliveryQuote(prisma,{city:'مركز تجريبي',village:'قرية '+tag});assert.equal(valid.fee.fee,'7.25');assert.equal(valid.eligibility.serviceable,true);
    const invalid=await resolveDeliveryQuote(prisma,{city:'مركز آخر',village:'قرية '+tag});assert.equal(invalid.eligibility.serviceable,false);
  });
  await test('zone deactivation and explicit ineligibility never fall back to acceptance',async()=>{
    const updated=await updateDeliveryZone(zone.id,{version:zone.version,isActive:false},admin);assert.equal((await resolveDeliveryQuote(prisma,{city:'مركز تجريبي',village:'قرية '+tag})).eligibility.serviceable,false);
    zone=await updateDeliveryZone(zone.id,{version:updated.version,isActive:true,scope:{...updated.scope,eligible:false}},admin);
    assert.equal((await resolveDeliveryQuote(prisma,{city:'مركز تجريبي',village:'قرية '+tag})).eligibility.serviceable,false);
  });
  await test('concurrent delivery edits have one winner and accurate old/new audit values',async()=>{
    const r=await Promise.allSettled([updateDeliveryZone(zone.id,{version:zone.version,fee:'8.00'},admin),updateDeliveryZone(zone.id,{version:zone.version,fee:'9.00'},admin)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);
    const last=(await dba.query("SELECT old_values,new_values FROM audit_logs WHERE entity_id=$1 AND action='delivery_zones.update' ORDER BY created_at DESC,id DESC LIMIT 1",[zone.id])).rows[0];assert.equal(last.old_values.fee,'7.25');assert.equal(last.old_values.version,zone.version);assert.equal(last.new_values.version,zone.version+1);
  });
} finally {
  await prisma.$disconnect();await dba.end();
  fs.writeFileSync('_recovery/v1-ops/evidence/postgres-integration.json',JSON.stringify({identity,total:results.length,failed:results.filter(r=>!r.pass).length,results},null,2));
  process.exitCode=results.some(r=>!r.pass)?1:0;
}
