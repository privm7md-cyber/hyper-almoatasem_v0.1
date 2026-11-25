// POS import integration tests — disposable DB (hyper_v1_ops_disposable, port 55449).
// Run: node scripts/v1-ops-isolated.mjs run scripts/v1-ops-pos-integration.mjs
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
import { assertDisposableConnection, assertDisposableEnvironment } from "./lib/disposable-db-guard.mjs";
assertDisposableEnvironment({ context: "v1-ops-pos-integration", requireKeys: ["DATABASE_URL", "V1_OPS_DATABASE_URL"] });
const dba=new Client({connectionString:process.env.V1_OPS_DATABASE_URL});await dba.connect();
await assertDisposableConnection(dba, { context: "v1-ops-pos-integration" });
const identity=(await dba.query("SELECT current_database() db,inet_server_port() port")).rows[0];
assert.equal(identity.db,'hyper_v1_ops_disposable');assert.equal(identity.port,55449);
const {prisma}=await import('../src/lib/db.ts');
const {parseInventoryFile}=await import('../src/lib/inventory/import-file.ts');
const {posImportPreview,posImportApply}=await import('../src/lib/inventory/pos-import.ts');
const admin=process.env.V1_OPS_ADMIN_ID, tag=randomUUID().slice(0,8);
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}

// ---- setup -------------------------------------------------------------------
const nameNew = `منتج جديد تجريبي-${tag}`;
const nameWeight = `منتج وزني تجريبي-${tag}`;
const categoryId=randomUUID(), matchedProductId=randomUUID(), matchedVariantId=randomUUID();
await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)",[categoryId,'POS Cat '+tag,'pos-cat-'+tag]);
await dba.query("INSERT INTO products(id,name,slug,category_id,product_type,unit,sale_step_grams) VALUES($1,$2,$2,$3,'PIECE','PIECE',null)",[matchedProductId,'موجود-'+tag,categoryId]);
await dba.query("INSERT INTO product_variants(id,product_id,name,size_value,size_unit,price) VALUES($1,$2,'',null,null,2.00)",[matchedVariantId,matchedProductId]);
await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'INTERNAL_CODE')",[matchedVariantId,'POS-MATCH-'+tag]);
await dba.query('INSERT INTO inventory(product_variant_id,quantity,reserved_quantity) VALUES($1,$2,0)',[matchedVariantId,'2.000']);

// ---- POS CSV fixture (Arabic headers — the real-world format) -----------------
const posCsv = "code,name,quantity,unit,source_price\n"
  + `POS-MATCH-${tag},,3,PIECE,9.99\n`           // matched → stock; source 9.99 vs current 2.00 → conflict review
  + `POS-NEW-${tag},${nameNew},5,PIECE,15.00\n`
  + `POS-NEWW-${tag},${nameWeight},2.5,KG,42.50\n`  // unmatched + name + KG → product create WEIGHT
  + `,منتج بدون كود,1,PIECE,\n`                   // rejected PRODUCT_NOT_FOUND
  + `POS-NONAME-${tag},,1,PIECE,\n`;             // rejected PRODUCT_NOT_FOUND (no name)
const fileName = `pos-${tag}.csv`;
const table = await parseInventoryFile(Buffer.from(posCsv, "utf8"), fileName);

// ---- preview -------------------------------------------------------------------
let preview;
try {
  preview = (await posImportPreview({categoryIdDefault: categoryId}, table)).parsed;
  console.log("PREVIEW SUMMARY:", JSON.stringify(preview.summary));
  console.log("PREVIEW STOCKROWS:", JSON.stringify(preview.stockRows));
  console.log("PREVIEW REJECTED:", JSON.stringify(preview.rejectedRows));
  console.log("PREVIEW CREATED:", JSON.stringify(preview.createdProducts.map(c => c.code)));
} catch (e) { preview = null; console.log("preview threw:", e.message); }
await test("POS preview: 1 stock row, 2 created, 2 rejected, 1 price conflict", async () => {
  assert.ok(preview);
  assert.equal(preview.summary.rows, 5);
  assert.equal(preview.summary.stockRows, 1);
  assert.equal(preview.summary.createdProducts, 2);
  assert.equal(preview.summary.rejectedRows, 2);
  assert.equal(preview.summary.priceConflicts, 1);
  const byCode = Object.fromEntries(preview.stockRows.map(r => [r.code, r]));
  assert.equal(byCode[`POS-MATCH-${tag}`].quantity, "3");
  assert.equal(byCode[`POS-MATCH-${tag}`].unit, "PIECE");
  const createCodes = preview.createdProducts.map(p => p.code);
  assert.ok(createCodes.includes(`POS-NEW-${tag}`) && createCodes.includes(`POS-NEWW-${tag}`));
  const w = preview.createdProducts.find(p => p.code === `POS-NEWW-${tag}`);
  assert.equal(w.productType, "WEIGHT");
  assert.equal(w.sizeUnit, "KG");
  const reasons = preview.rejectedRows.map(r => r.reason).sort();
  assert.deepEqual(reasons, ["MISSING_CODE", "PRODUCT_NOT_FOUND"]);
});

// ---- dup protection (product name collision → reject) ------------------------
let dupId;
await test("POS dup protection: existing product name rejects apply", async () => {
  dupId = randomUUID();
  await dba.query("INSERT INTO products (id,name,slug,category_id,product_type,unit,is_active) VALUES($1,$2,$3,$4,'PIECE','PIECE',true)", [dupId, nameNew, `dup-${tag}`, categoryId]);
  await assert.rejects(posImportApply({ source: "pos-it-" + randomUUID(), asOf: "2026-01-01T00:00:00Z", reason: "POS synthetic dup" }, table, admin), /already exists/);
  await dba.query("DELETE FROM products WHERE id=$1", [dupId]);
});

// ---- apply ---------------------------------------------------------------------
let applied;
try {
  applied = await posImportApply({ source: "pos-it-" + randomUUID(), asOf: "2026-01-01T00:00:00Z", reason: "POS synthetic" }, table, admin);
} catch (e) { console.log("apply threw:", e.message); }
await test("POS apply: 2 created, stock 1 applied, price conflict not applied", async () => {
  assert.ok(applied);
  assert.equal(applied.created, 2);
  assert.equal(applied.stock.summary.accepted, 1);
  // matched product price unchanged (source price never auto-applied)
  const priceRow = await dba.query('SELECT price::text p FROM product_variants WHERE id=$1', [matchedVariantId]);
  assert.equal(priceRow.rows[0].p, "2.00");
  // matched variant quantity updated: 2.000 → 3.000 (POS row 3)
  const invRow = await dba.query('SELECT quantity::text q FROM inventory WHERE product_variant_id=$1', [matchedVariantId]);
  assert.equal(invRow.rows[0].q, "3.000");
  const mv = await dba.query("SELECT count(*)::int n FROM inventory_movements WHERE product_variant_id=$1 AND movement_type='ADJUSTMENT' AND quantity='1.000' AND previous_quantity='2.000' AND new_quantity='3.000'", [matchedVariantId]);
  assert.equal(mv.rows[0].n, 1);
  // new products created with codes
  const np = await dba.query("SELECT p.id::text id, v.id::text vid, p.product_type::text pt, v.size_unit::text su, p.name FROM products p JOIN product_variants v ON v.product_id=p.id WHERE p.name IN ($1,$2)", [nameNew, nameWeight]);
  assert.equal(np.rowCount, 2);
  const ptByName = new Map(np.rows.map(r => [r.pt, r]));
  assert.ok(ptByName.has('PIECE'));
  assert.ok(ptByName.has('WEIGHT'));
  assert.equal(np.rows.find(r => r.pt === 'WEIGHT').su, 'KG');
  const codes = await dba.query("SELECT count(*)::int n FROM product_codes c JOIN product_variants v ON v.id=c.product_variant_id WHERE v.id IN ($1,$2)", [np.rows[0].vid, np.rows[1].vid]);
  assert.equal(codes.rows[0].n, 2);
  // POS product_create audits
  const audits = await dba.query("SELECT count(*)::int n FROM audit_logs WHERE action='pos.product_create'");
  assert.ok(audits.rows[0].n >= 2);
});

await prisma.$disconnect(); await dba.end();
fs.writeFileSync("_recovery/v1-ops/evidence/postgres-pos.json", JSON.stringify({identity, total: results.length, failed: results.filter(r=>!r.pass).length, results}, null, 2));
process.exitCode = results.some(r=>!r.pass) ? 1 : 0;
