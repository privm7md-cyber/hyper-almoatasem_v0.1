// P0 — Checkout & delivery safety verdict — API-level tests on the disposable DB (prisma/pg).
// Scenarios:
//   A. Unconfigured area (allow): order creates; backend fee = default (20.00); eligibility UNCONFIGURED.
//   B. Scoped zone (village match): order creates with the zone fee; non-match with scoped zones → businessRule (reject).
//   C. Unknown stock (no inventory row): valid active product still orders.
//   D. Known-zero stock: valid active product still orders; no fabricated reserve.
//   E. Guest and registered checkout use the same stockless policy.
// All on the disposable DB — the policy switch is read per call from process.env.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s==='next/headers')return next('next/headers.js',c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  if((s.startsWith('./')||s.startsWith('../')) && !path.extname(s) && c?.parentURL){
    const p = path.resolve(path.dirname(fileURLToPath(c.parentURL)), s);
    if(existsSync(p + '.ts'))return next(pathToFileURL(p + '.ts').href,c);
  }
  return next(s,c);
}});
import { Client } from "pg";
import { assertDisposableConnection, assertDisposableEnvironment } from "./lib/disposable-db-guard.mjs";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
assertDisposableEnvironment({ context: "v1-ops-checkout-safety-tests", requireKeys: ["DATABASE_URL"] });
const dba = new Client({ connectionString: process.env.DATABASE_URL });
await dba.connect();
await assertDisposableConnection(dba, { context: "v1-ops-checkout-safety-tests" });
const { prisma } = await import('../src/lib/db.ts');
const { createOrder } = await import('../src/lib/orders/writes.ts');
const { resolveDeliveryQuote } = await import('../src/lib/orders/delivery-fee.ts');
const { createDeliveryZone } = await import('../src/lib/admin/delivery-zones.ts');

const admin = process.env.V1_OPS_ADMIN_ID;
const results = [];
async function test(name, fn){ try { await fn(); results.push({name, pass: true}); console.log('PASS ' + name); } catch (e) { results.push({name, pass: false, error: e.message}); console.log('FAIL ' + name + ': ' + e.message + ' actual=' + JSON.stringify(e.actual) + ' expected=' + JSON.stringify(e.expected)); } }
const orderRow = async (id) => (await dba.query('SELECT delivery_fee::text AS delivery_fee, total_final::text AS total FROM orders WHERE id=$1', [id])).rows[0];
const insertVariant = async (productId, tag, suffix, withInventory, quantity) => {
  const v = randomUUID();
  await dba.query("INSERT INTO product_variants(id,product_id,name,price,is_active) VALUES($1,$2,$3,2.50,true)", [v, productId, 'v-' + suffix + '-' + tag]);
  await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'INTERNAL_CODE')", [v, 'p0-' + suffix + '-' + tag]);
  if (withInventory) await dba.query('INSERT INTO inventory(product_variant_id,quantity,reserved_quantity) VALUES($1,$2,0)', [v, quantity]);
  return v;
};

// ---------- setup ----------
const tag = randomUUID().slice(0, 8);
const catId = randomUUID();
await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$2)", [catId, 'cat-p0-' + tag]);
const prod = await prisma.product.create({ data: { id: randomUUID(), name: 'p0a-' + tag, slug: 'p0a-' + tag, categoryId: catId, productType: 'PIECE', unit: 'PIECE', isActive: true } });
const vA = await insertVariant(prod.id, tag, 'a', true, '5.000');
const prodB = await prisma.product.create({ data: { id: randomUUID(), name: 'p0b-' + tag, slug: 'p0b-' + tag, categoryId: catId, productType: 'PIECE', unit: 'PIECE', isActive: true } });
const vB = await insertVariant(prodB.id, tag, 'b', true, '0.000');
const prodC = await prisma.product.create({ data: { id: randomUUID(), name: 'p0c-' + tag, slug: 'p0c-' + tag, categoryId: catId, productType: 'PIECE', unit: 'PIECE', isActive: true } });
const vC = await insertVariant(prodC.id, tag, 'c', false);

async function mkCart(variantId, quantity) {
  const cartId = randomUUID(); const sessionHash = randomUUID().toString();
  await dba.query('INSERT INTO carts(id,session_id,status) VALUES($1,$2,$3)', [cartId, sessionHash, 'ACTIVE']);
  await dba.query('INSERT INTO cart_items(cart_id,product_variant_id,quantity,unit_snapshot,unit_price_snapshot) VALUES($1,$2,$3,$4,$5)', [cartId, variantId, quantity, 'PIECE', '2.50']);
  return sessionHash;
}
const mkArgs = (sessionHash, address, fee) => ({
  owner: { kind: 'guest', sessionHash }, customerId: null, addressId: null,
  guest: { contact: { firstName: 'فاز' + tag, lastName: 'متار' }, address: { phone: '971501234567', ...address } },
  idempotencyKey: randomUUID().toString(), expectedDeliveryFee: fee, expectedDeliveryEligibility: null,
});
const mkCustomerCart = async (variantId, quantity) => {
  const customerId = randomUUID();
  const addressId = randomUUID();
  const cartId = randomUUID();
  await dba.query(
    "INSERT INTO customers(id,first_name,last_name,phone,password_hash,is_registered,is_active) VALUES($1,$2,$3,$4,$5,true,true)",
    [customerId, 'مسجل' + tag, 'اختبار', `20${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`, 'synthetic-fixture-not-used-for-authentication'],
  );
  await dba.query(
    "INSERT INTO customer_addresses(id,customer_id,city,village,phone,is_default) VALUES($1,$2,$3,$4,$5,true)",
    [addressId, customerId, cityA, villageA, '201001234567'],
  );
  await dba.query("INSERT INTO carts(id,customer_id,status) VALUES($1,$2,'ACTIVE')", [cartId, customerId]);
  await dba.query(
    'INSERT INTO cart_items(cart_id,product_variant_id,quantity,unit_snapshot,unit_price_snapshot) VALUES($1,$2,$3,$4,$5)',
    [cartId, variantId, quantity, 'PIECE', '2.50'],
  );
  return { customerId, addressId };
};
const cityA = 'مدينة تجريبية ' + tag, villageA = 'قرية تجريبية ' + tag;

try {
  await dba.query('DELETE FROM delivery_zones');
  await dba.query("DELETE FROM store_settings WHERE key LIKE 'delivery.zone.%'");
  await test('A: unconfigured area (allow): order creates; backend fee = default; eligibility UNCONFIGURED', async () => {
    const addrA = { city: cityA, village: villageA };
    const quote = await resolveDeliveryQuote(prisma, addrA);
    assert.equal(quote.eligibility.status, 'UNCONFIGURED');
    assert.equal(quote.eligibility.serviceable, true);
    const sessionHash = await mkCart(vA, '2');
    const r = await createOrder(mkArgs(sessionHash, addrA, quote.fee.fee));
    assert.ok(r.orderId);
    const row = await orderRow(r.orderId);
    assert.equal(row.delivery_fee, quote.fee.fee);
  });

  await test('B: scoped zone match: order creates with the zone fee (backend-authoritative)', async () => {
    await createDeliveryZone({ name: 'قرية تجريبية ' + tag, fee: '7.25', scope: { city: cityA, locality: villageA, field: 'village', eligible: true } }, admin);
    await dba.query('UPDATE inventory SET quantity=$2 WHERE product_variant_id=$1', [vB, '5.000']);
    const addrMatch = { city: cityA, village: villageA };
    const quote = await resolveDeliveryQuote(prisma, addrMatch);
    assert.equal(quote.eligibility.status, 'ZONE_MATCHED');
    assert.equal(quote.eligibility.serviceable, true);
    assert.equal(quote.fee.fee, '7.25');
    const sessionHash = await mkCart(vB, '2');
    const r = await createOrder(mkArgs(sessionHash, addrMatch, quote.fee.fee));
    assert.ok(r.orderId);
    const row = await orderRow(r.orderId);
    assert.equal(row.delivery_fee, '7.25');
  });

  await test('B2: unmatched address with scoped zones → businessRule refusal (reject policy)', async () => {
    process.env.DELIVERY_ELIGIBILITY_POLICY = 'allow'; // scoped zone exists → policy is reject regardless of env
    const addrOther = { city: 'مدينة أخرى ' + tag, village: 'قرية أخرى ' + tag };
    const quote = await resolveDeliveryQuote(prisma, addrOther);
    assert.equal(quote.eligibility.serviceable, false);
    const sessionHash = await mkCart(vB, '2');
    await assert.rejects(createOrder(mkArgs(sessionHash, addrOther, '7.25')), /outside the store's delivery areas/i);
  });

  await test('C: unknown stock (no inventory row): guest order creates without invented inventory', async () => {
    const quote = await resolveDeliveryQuote(prisma, { city: cityA, village: villageA });
    const sessionHash = await mkCart(vC, '2');
    const r = await createOrder(mkArgs(sessionHash, { city: cityA, village: villageA }, quote.fee.fee));
    assert.ok(r.orderId);
    const inventory = await dba.query('SELECT 1 FROM inventory WHERE product_variant_id=$1', [vC]);
    assert.equal(inventory.rowCount, 0);
  });

  await test('D: known-zero stock: guest order creates and reserve is not fabricated', async () => {
    await dba.query('UPDATE inventory SET quantity=$2, reserved_quantity=0 WHERE product_variant_id=$1', [vB, '0.000']);
    const sessionHash0 = await mkCart(vB, '1');
    const r = await createOrder(mkArgs(sessionHash0, { city: cityA, village: villageA }, '7.25'));
    assert.ok(r.orderId);
    const inventory = await dba.query('SELECT quantity::text, reserved_quantity::text FROM inventory WHERE product_variant_id=$1', [vB]);
    assert.equal(inventory.rows[0].quantity, '0.000');
    assert.equal(inventory.rows[0].reserved_quantity, '0.000');
  });

  await test('E: registered checkout follows the same stockless policy', async () => {
    const registered = await mkCustomerCart(vC, '1');
    const quote = await resolveDeliveryQuote(prisma, { city: cityA, village: villageA });
    const r = await createOrder({
      owner: { kind: 'customer', customerId: registered.customerId },
      customerId: registered.customerId,
      addressId: registered.addressId,
      guest: null,
      idempotencyKey: randomUUID().toString(),
      expectedDeliveryFee: quote.fee.fee,
      expectedDeliveryEligibility: quote.eligibility.status,
    });
    assert.ok(r.orderId);
    assert.equal(r.guestToken, null);
  });
} finally {
  await prisma.$disconnect(); await dba.end();
  writeFileSync('_recovery/v1-ops/evidence/checkout-safety-tests.json', JSON.stringify({ db: 'hyper_v1_ops_disposable', total: results.length, failed: results.filter(r=>!r.pass).length, results }, null, 2));
  process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
}
