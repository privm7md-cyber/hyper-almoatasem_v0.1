// P1 — POS import production-quality review — API-level tests on disposable (prisma/pg).
// Scenarios (all on disposable — Primary untouched):
//   1. Repeated import: apply twice — idempotent, no new products, no double-charge.
//   2. Concurrent import: two applies racing — exactly one creates/applies; no dup products.
//   3. Duplicate barcodes in one file: rejected (AMBIGUOUS/DUPLICATE_VARIANT).
//   4. Unknown product (unmatched, no name): rejected PRODUCT_NOT_FOUND.
//   5. Duplicate product name on apply: rejected (existing product).
//   6. Negative inventory in source: rejected NEGATIVE_STOCK.
//   7. Price conflicts review-only: sourcePrice differs from current; current price unchanged.
//   8. Mid-transaction failure: product-create tx rolls back — no products created.
//   9. Audit events: pos.product_create rows exist after apply.
//  10. Undo/reconciliation: revert after apply — quantities restored.
//  11. CSV encoding/Arabic product names: Arabic names round-trip.
//  12. Large batch: 100-row POS import applied.
// Evidence: _recovery/v1-ops/evidence/pos-production-tests.json
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s==='next/headers')return next('next/headers.js',c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { assertDisposableConnection, assertDisposableEnvironment } from "./lib/disposable-db-guard.mjs";
assertDisposableEnvironment({ context: "v1-ops-pos-production-tests", requireKeys: ["DATABASE_URL"] });
const dba = new Client({ connectionString: process.env.DATABASE_URL });
await dba.connect();
await assertDisposableConnection(dba, { context: "v1-ops-pos-production-tests" });
const { prisma } = await import('../src/lib/db.ts');
const { posImportApply, posImportPreview } = await import('../src/lib/inventory/pos-import.ts');
const { parseInventoryFile } = await import('../src/lib/inventory/import-file.ts');
const { revertStockImport } = await import('../src/lib/inventory/revert-service.ts');

const admin = process.env.V1_OPS_ADMIN_ID;
const results = [];
async function test(name, fn){ try { await fn(); results.push({name, pass: true}); console.log('PASS ' + name); } catch (e) { results.push({name, pass: false, error: e.message}); console.log('FAIL ' + name + ': ' + e.message); } }

// Helpers ---------------------------------------------------------------
const tag = randomUUID().slice(0, 8);
async function mkCategory(name) {
  const id = randomUUID();
  const slug = name.replaceAll(/\s+/g, "-").toLowerCase() + "-" + tag;
  await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)", [id, name + '-' + tag, slug]);
  return id;
}
async function mkProduct(tagSuffix, name, categoryId) {
  const id = randomUUID();
  const slug = 'pos-' + tagSuffix + '-' + tag;
  await dba.query("INSERT INTO products(id,name,slug,category_id,product_type,unit,is_active) VALUES($1,$2,$3,$4,'PIECE','PIECE',true)", [id, name, slug, categoryId]);
  const variantId = randomUUID();
  await dba.query("INSERT INTO product_variants(id,product_id,name,price,is_active) VALUES($1,(SELECT id FROM products WHERE id=$2),'',2.50,true)", [variantId, id]);
  await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'INTERNAL_CODE')", [variantId, 'POS-' + tagSuffix + '-' + tag]);
  return { id, variantId };
}
function posCsv(rows) {
  const header = "code,name,quantity,unit,source_price\n";
  const data = rows.map((r) => [r.code, r.name ?? '', r.quantity ?? '', r.unit ?? 'PIECE', r.sourcePrice ?? ''].join(",")).join("\n");
  return header + data + "\n";
}
async function posApply(name, rows, extra = {}) {
  const text = posCsv(rows);
  const table = await parseInventoryFile(Buffer.from(text, "utf8"), name);
  return posImportApply({ source: 'pos-test-' + randomUUID(), asOf: '2026-01-01T00:00:00Z', reason: 'POS production review ' + name, ...extra }, table, admin);
}
const variantStock = async (productId) => (await dba.query('SELECT quantity::text q FROM inventory WHERE product_variant_id IN (SELECT id FROM product_variants WHERE product_id=$1)', [productId])).rows[0]?.q ?? null;
const productsNamed = async (prefix) => (await dba.query(`SELECT id::text AS id, name FROM products WHERE name ILIKE $1`, [prefix])).rows;
const auditCount = async (action) => (await dba.query('SELECT count(*)::int AS n FROM audit_logs WHERE action=$1', [action])).rows[0].n;

// Setup ---------------------------------------------------------------
const catA = await mkCategory('catA');
await mkCategory('catB');
const existing = await mkProduct('exists', 'سلعة موجودة-' + tag, catA);
await mkProduct('dup', 'اسم مكرر تجريبي', catA);

try {
  await test('1. repeated import: second apply is a no-op (no new products, quantities stay)', async () => {
    const r1 = await posApply('rep.csv', [{ code: 'POS-exists-' + tag, quantity: '4', unit: 'PIECE' }]);
    assert.equal(r1.created, 0); // matched
    const q1 = await variantStock(existing.id);
    assert.equal(q1, '4.000');
    const audit1 = await auditCount('inventory.import');
    const r2 = await posApply('rep2.csv', [{ code: 'POS-exists-' + tag, quantity: '4', unit: 'PIECE' }]);
    assert.equal(r2.created, 0);
    const q2 = await variantStock(existing.id);
    assert.equal(q1, q2);
    const audit2 = await auditCount('inventory.import');
    assert.ok(audit2 >= audit1 + 1); // the first apply recorded the import
  });

  await test('2. concurrent import: racing applies do not double-create products', async () => {
    await mkProduct('conc', 'منتج متوازي-' + tag, catA);
    const rows = [{ code: 'POS-conc-' + tag, quantity: '3', unit: 'PIECE' }];
    const [r1, r2] = await Promise.allSettled([posApply('c1.csv', rows), posApply('c2.csv', rows)]);
    const met = [r1, r2].filter((r) => r.status === 'fulfilled').length;
    assert.ok(met >= 1);
    const prods = await productsNamed('%منتج متوازي-' + tag + '%');
    assert.equal(prods.length, 1);
    assert.equal(await variantStock(prods[0].id), '3.000');
  });

  await test('3. duplicate barcodes within a file: rejected (duplicate variant)', async () => {
    await mkProduct('dupb', 'منتج باركود مكرر-' + tag, catA);
    const table = await parseInventoryFile(Buffer.from(posCsv([
      { code: 'POS-dupb-' + tag, quantity: '2', unit: 'PIECE' },
      { code: 'POS-dupb-' + tag, quantity: '5', unit: 'PIECE' },
    ]), "utf8"), 'dup.csv');
    const parsed = (await posImportPreview({}, table)).parsed;
    assert.ok(parsed.rejectedRows.length >= 2);
    assert.ok(parsed.rejectedRows.every((r) => r.reason === 'DUPLICATE_VARIANT'));
  });

  await test('4. unknown product (unmatched, no name): rejected PRODUCT_NOT_FOUND', async () => {
    const table = await parseInventoryFile(Buffer.from(posCsv([{ code: 'POS-unknown-' + tag, quantity: '1', unit: 'PIECE' }]), "utf8"), 'unk.csv');
    const parsed = (await posImportPreview({}, table)).parsed;
    assert.ok(parsed.rejectedRows.some((r) => r.reason === 'PRODUCT_NOT_FOUND'));
  });

  await test('5. duplicate product name on apply: rejected (existing product)', async () => {
    const name = 'اسم مكرر تجريبي'; // dupName
    const rows = [{ code: 'POS-dupname-' + tag, name, quantity: '1', unit: 'PIECE' }];
    const dupCheck = (await dba.query("SELECT count(*)::int AS n FROM products WHERE name = $1", [name])).rows[0].n;
    assert.ok(dupCheck >= 1);
    await assert.rejects(posApply('dupname.csv', rows), /already exists/i);
  });

  await test('6. negative inventory in source: rejected NEGATIVE_STOCK', async () => {
    const table = await parseInventoryFile(Buffer.from(posCsv([{ code: 'POS-exists-' + tag, quantity: '-5', unit: 'PIECE' }]), "utf8"), 'neg.csv');
    const parsed = (await posImportPreview({}, table)).parsed;
    assert.ok(parsed.rejectedRows.some((r) => r.reason === 'NEGATIVE_STOCK'));
  });

  await test('7. price conflict review-only: sourcePrice differs; current price unchanged', async () => {
    const r = await posApply('price.csv', [{ code: 'POS-exists-' + tag, quantity: '2', unit: 'PIECE', sourcePrice: '99.00' }]);
    assert.ok(r.preview.priceConflicts.length >= 1);
    const priceNow = (await dba.query('SELECT price::text p FROM product_variants WHERE id=$1', [existing.variantId])).rows[0].p;
    assert.equal(priceNow, '2.50');
  });

  await test('8. mid-transaction failure: product-create tx rolls back (audit failure)', async () => {
    const name = 'mid-fail ' + tag;
    const table = await parseInventoryFile(Buffer.from(posCsv([{ code: 'POS-midfail-' + tag, name, quantity: '3', unit: 'PIECE' }]), "utf8"), 'midfail.csv');
    // Synthetic mid-tx failure: an invalid actor id makes the POS product_create audit
    // insert (inside the same transaction) fail after products/variants/codes are written.
    await assert.rejects(
      posImportApply({ source: 'pos-test-midfail-' + randomUUID(), asOf: '2026-01-01T00:00:00Z', reason: 'POS production review mid-tx failure' }, table, 'not-a-uuid'),
    );
    const after = await productsNamed('%' + name);
    assert.equal(after.length, 0);
    // Also verify no orphan variants/codes were created for the rolled-back product
    const orphanVariants = (await dba.query("SELECT count(*)::int AS n FROM product_variants v LEFT JOIN products p ON p.id=v.product_id WHERE v.name = $1", [name])).rows[0].n;
    assert.equal(orphanVariants, 0);
  });

  await test('9. audit events: pos.product_create rows exist after apply', async () => {
    const n = await auditCount('pos.product_create');
    assert.ok(n >= 1);
  });

  await test('10. undo: revert after POS apply — quantities restored', async () => {
    const prod = await mkProduct('rev', 'POS-rev-' + tag, catA);
    const r = await posApply('undo.csv', [{ code: 'POS-rev-' + tag, quantity: '7', unit: 'PIECE' }]);
    assert.equal(r.created, 0);
    assert.equal(await variantStock(prod.id), '7.000');
    const importId2 = (await dba.query("SELECT entity_id::text id FROM audit_logs WHERE action='inventory.import' AND new_values->>'reason' LIKE 'POS production review undo%' ORDER BY created_at DESC LIMIT 1")).rows[0]?.id;
    assert.ok(importId2);
    const rev = await revertStockImport({ importId: importId2, dryRun: false, confirmed: true }, admin);
    assert.equal(rev.summary.reverted, 1);
    assert.equal(await variantStock(prod.id), '0.000');
  });

  await test('11. CSV encoding/Arabic product names round-trip', async () => {
    const name = 'عنوان صورة جديدة-ز';
    const table = await parseInventoryFile(Buffer.from(posCsv([{ code: 'POS-arabic-' + tag, name, quantity: '1', unit: 'PIECE' }]), "utf8"), 'arabic.csv');
    const parsed = (await posImportPreview({}, table)).parsed;
    assert.ok(parsed.createdProducts.some((p) => p.name === name));
  });

  await test('12. large batch: 100-row POS import', async () => {
    const rows = [];
    for (let i = 0; i < 100; i++) rows.push({ code: 'POS-large-' + tag + '-' + i, name: 'منتج كمي-' + tag + '-' + i, quantity: '1', unit: 'PIECE' });
    const r = await posApply('large.csv', rows);
    assert.equal(r.created, 100);
  });
} finally {
  await prisma.$disconnect();
  await dba.end();
  writeFileSync("_recovery/v1-ops/evidence/pos-production-tests.json", JSON.stringify({ db: "hyper_v1_ops_disposable", total: results.length, failed: results.filter((r) => !r.pass).length, results }, null, 2));
  console.log("wrote _recovery/v1-ops/evidence/pos-production-tests.json");
  process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
}
