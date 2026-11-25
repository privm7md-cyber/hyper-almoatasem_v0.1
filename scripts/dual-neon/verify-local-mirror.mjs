import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogWebhook, claimBatch, compareField, completeDelivery, deliverCatalogBatch, encodeEvent, receiveEvent, signEvent } from "./catalog-delivery.mjs";

const runtime = process.argv[2];
if (!runtime) throw new Error("Pass the local PGlite module path");
const { PGlite } = await import(pathToFileURL(resolve(runtime)).href);
const source = new PGlite();
const studio = new PGlite();
const sql = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const allowedSource = randomUUID();
const secret = randomBytes(32);
const category = randomUUID();
const brand = randomUUID();
const product = randomUUID();
const variant = randomUUID();
const code = randomUUID();
const scenarios = [];
const delays = [];

async function deliver(row, overrides = {}) {
  const bytes = encodeEvent(row);
  return receiveEvent(studio, { allowedSource, secret, signed: signEvent(secret, bytes), bytes, ...overrides });
}

async function drain() {
  const { rows, lease } = await claimBatch(source);
  for (const row of rows) {
    const receipt = await deliver(row);
    assert.equal(receipt.ok, true);
    assert.equal(await completeDelivery(source, row, lease, receipt.status), true);
    delays.push(Date.now() - new Date(row.occurred_at).getTime());
  }
  return rows;
}

async function body(entityId) {
  const { rows } = await studio.query("SELECT body FROM website_mirror.entities WHERE entity_id = $1", [entityId]);
  assert.equal(rows.length, 1);
  return rows[0].body;
}

try {
  await source.exec(sql("../../prisma/migrations/20260923_baseline__official/migration.sql"));
  await source.exec(sql("./website-outbox.sql"));
  await studio.exec(sql("./studio-mirror.sql"));
  await source.query("INSERT INTO catalog_feed.source (source_id) VALUES ($1)", [allowedSource]);
  await studio.query("INSERT INTO website_mirror.source (source_id) VALUES ($1)", [allowedSource]);
  await studio.exec(`CREATE TABLE local_draft (product_id uuid, base_price text, proposed_price text);
    CREATE TABLE owner_activity (id uuid); CREATE TABLE owner_review (id uuid)`);
  await studio.query("INSERT INTO local_draft VALUES ($1, '1.50', '14.75')", [product]);

  await source.query("INSERT INTO categories (id,name,slug) VALUES ($1,'مواد غذائية','food')", [category]);
  await source.query("INSERT INTO brands (id,name,slug) VALUES ($1,'علامة','brand')", [brand]);
  await source.query(`INSERT INTO products (id,name,slug,category_id,brand_id,product_type,unit)
    VALUES ($1,'أرز','rice',$2,$3,'PIECE','PIECE')`, [product, category, brand]);
  await source.query(`INSERT INTO product_variants (id,product_id,name,price,cost_price)
    VALUES ($1,$2,'أرز',1.50,1.00)`, [variant, product]);
  await source.query(`INSERT INTO product_codes (id,product_variant_id,code,type)
    VALUES ($1,$2,'000123','BARCODE')`, [code, variant]);
  const initial = await drain();
  assert.equal(initial.length, 5);
  assert.equal((await body(code)).code, "000123");
  assert.equal((await body(variant)).price, "1.50");
  assert.equal(Object.hasOwn(await body(variant), "cost_price"), false);
  assert.equal((await body(product)).brand_id, brand);
  assert.equal((await body(product)).category_id, category);
  scenarios.push("product, variant, code and reference creation with catalog-only payloads");

  await source.query("UPDATE products SET name = 'أرز مصري' WHERE id = $1", [product]);
  await source.query("UPDATE brands SET name = 'علامة جديدة' WHERE id = $1", [brand]);
  await source.query("UPDATE categories SET name = 'بقالة' WHERE id = $1", [category]);
  await drain();
  assert.equal((await body(product)).name, "أرز مصري");
  assert.equal((await body(brand)).name, "علامة جديدة");
  assert.equal((await body(category)).name, "بقالة");
  assert.equal(compareField({ base: "1.50", website: (await body(variant)).price, proposal: "14.75", pending: true }), "PENDING_APPROVAL");
  scenarios.push("name and reference changes create no false price conflict");

  await source.query("UPDATE product_variants SET price = 2.00 WHERE id = $1", [variant]);
  await source.query("UPDATE product_variants SET price = 3.00 WHERE id = $1", [variant]);
  const { rows, lease } = await claimBatch(source);
  const [v2, v3] = rows.sort((a, b) => Number(BigInt(a.revision) - BigInt(b.revision)));
  assert.equal((await deliver(v3)).outcome, "applied");
  assert.equal((await deliver(v2)).outcome, "stale");
  assert.equal((await deliver(v3)).outcome, "duplicate");
  assert.equal((await body(variant)).price, "3.00");
  assert.equal(compareField({ base: "1.50", website: "3.00", proposal: "14.75", pending: true }), "CONFLICTED");
  assert.equal(compareField({ base: "1.50", website: "3.00", proposal: "14.75", pending: false }), "MIRRORED");
  const bytes = encodeEvent(v3);
  assert.equal((await deliver(v3, { signed: signEvent(secret, bytes, Date.now() - 360000) })).status, 401);
  assert.equal((await deliver(v3, { signed: signEvent(randomBytes(32), bytes) })).status, 401);
  assert.equal((await deliver(v3, { allowedSource: randomUUID() })).status, 403);
  const changed = Buffer.from(bytes.toString().replace('"3.00"', '"4.00"'));
  assert.equal((await deliver(v3, { bytes: changed, signed: signEvent(secret, changed) })).status, 409);
  assert.equal(await completeDelivery(source, v3, randomUUID(), 200), false);
  for (const row of rows) assert.equal(await completeDelivery(source, row, lease, 200), true);
  scenarios.push("out-of-order, duplicate, changed replay, stale signature, wrong signing key and wrong source");

  await source.query("BEGIN");
  await source.query("UPDATE products SET deleted_at = now() WHERE id = $1", [product]);
  await source.query("ROLLBACK");
  assert.equal((await claimBatch(source)).rows.length, 0);
  await source.query("UPDATE products SET deleted_at = now() WHERE id = $1", [product]);
  await drain();
  assert.ok((await body(product)).deleted_at);
  await source.query("UPDATE products SET deleted_at = NULL WHERE id = $1", [product]);
  await drain();
  assert.equal((await body(product)).deleted_at, null);
  scenarios.push("rollback emits no event, archive and restore converge");

  await source.exec("ALTER TABLE public.product_codes DISABLE TRIGGER catalog_feed");
  await source.query("DELETE FROM product_codes WHERE id = $1", [code]);
  await source.exec("ALTER TABLE public.product_codes ENABLE TRIGGER catalog_feed");
  assert.equal((await claimBatch(source)).rows.length, 0);
  const recoveryStart = performance.now();
  assert.deepEqual((await source.query("SELECT catalog_feed.reconcile(100) AS changes")).rows, [{ changes: 1 }]);
  await drain();
  assert.equal(await body(code), null);
  assert.deepEqual((await source.query("SELECT catalog_feed.reconcile(100) AS changes")).rows, [{ changes: 0 }]);
  const recoveryMs = performance.now() - recoveryStart;
  scenarios.push("reconciliation detects and tombstones an uncaptured deletion");

  await source.query("UPDATE product_variants SET price = 4.00 WHERE id = $1", [variant]);
  const outage = await claimBatch(source);
  assert.equal(await completeDelivery(source, outage.rows[0], outage.lease, 503), true);
  assert.equal((await body(variant)).price, "3.00");
  assert.equal((await claimBatch(source)).rows.length, 0);
  await source.exec("UPDATE catalog_feed.outbox SET available_at = now() WHERE delivered_at IS NULL");
  const recovered = await drain();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].attempts, 2);
  assert.equal((await body(variant)).price, "4.00");
  const { rows: [editorial] } = await studio.query(`SELECT proposed_price,
    (SELECT count(*)::int FROM owner_activity) AS activity, (SELECT count(*)::int FROM owner_review) AS reviews FROM local_draft`);
  assert.deepEqual(editorial, { proposed_price: "14.75", activity: 0, reviews: 0 });
  scenarios.push("temporary receiver outage retries without touching draft, activity or reviews");

  let connections = 0;
  const pool = { connect: async () => {
    connections += 1;
    return { query: studio.query.bind(studio), release() {} };
  } };
  const receive = (request) => catalogWebhook(request, { pool, secret, allowedSource });
  const endpoint = "https://studio.example.invalid/catalog-mirror";
  const anonymous = await receive(new Request(endpoint, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(anonymous.status, 401);
  const oversized = await receive(new Request(endpoint, {
    method: "POST", headers: { "content-type": "application/json" }, body: "a".repeat(9000),
  }));
  assert.equal(oversized.status, 413);
  assert.equal(connections, 0);
  await source.query("UPDATE product_variants SET price = 5.00 WHERE id = $1", [variant]);
  const fakePage = await deliverCatalogBatch(source, { endpoint, secret, send: async () => new Response("<html>Login</html>") });
  assert.equal(fakePage[0].status, 503);
  assert.equal((await body(variant)).price, "4.00");
  await source.exec("UPDATE catalog_feed.outbox SET available_at = now() WHERE delivered_at IS NULL");
  const throughHandler = await deliverCatalogBatch(source, {
    endpoint, secret, send: async (url, options) => receive(new Request(url, options)),
  });
  assert.equal(connections, 1);
  assert.equal(throughHandler[0].status, 200);
  assert.equal((await body(variant)).price, "5.00");
  scenarios.push("HTTP handler rejects unsigned and oversized bodies before accessing PostgreSQL and requires a real delivery receipt");

  delays.sort((a, b) => a - b);
  const percentile = (p) => delays[Math.ceil(p * delays.length) - 1];
  console.log(JSON.stringify({
    environment: "separate embedded PostgreSQL instances with in-process delivery",
    scenarios, directDeliverySamples: delays.length,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), smallFixtureReconciliationMs: recoveryMs,
  }, null, 2));
} finally {
  await Promise.all([source.close(), studio.close()]);
}
