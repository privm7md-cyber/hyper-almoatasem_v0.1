// Mutation-heavy Phase B acceptance against the independent disposable
// PostgreSQL cluster only. The identity guards intentionally duplicate the
// Phase D/E integration harness so this script cannot target Primary/Scratch.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { Client } from "pg";
import { assertDisposableEnvironment } from "../lib/disposable-db-guard.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return nextResolve(pathToFileURL(path.resolve("vitest.server-only-stub.cjs")).href, context);
    if (specifier === "next/headers") return nextResolve("next/headers.js", context);
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.resolve("src", `${specifier.slice(2)}.ts`)).href, context);
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier) && context?.parentURL) {
      const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      if (existsSync(`${candidate}.ts`)) return nextResolve(pathToFileURL(`${candidate}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});

assertDisposableEnvironment({ context: "phase-b-isolated-integration", requireKeys: ["DATABASE_URL", "V1_OPS_DATABASE_URL"] });
const dba = new Client({ connectionString: process.env.V1_OPS_DATABASE_URL });
await dba.connect();
const identity = (await dba.query(`
  SELECT current_database() AS database, inet_server_port() AS port,
         current_setting('data_directory') AS data_directory
`)).rows[0];
assert.equal(identity.database, "hyper_v1_ops_disposable");
assert.equal(identity.port, 55449);
assert.equal(path.resolve(identity.data_directory), path.resolve("_recovery/v1-ops/pgdata"));

const { prisma } = await import("../../src/lib/db.ts");
const {
  decideReplacement,
  proposeReplacement,
  rejectAllProposedReplacements,
} = await import("../../src/lib/replacements/writes.ts");
const { parseStoredAlternativesEnvelope } = await import("../../src/lib/replacements/validation.ts");

const actorId = process.env.V1_OPS_ADMIN_ID;
const tag = randomUUID().slice(0, 8);
const results = [];
async function test(name, operation) {
  try {
    await operation();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const categoryId = randomUUID();
const productIds = Array.from({ length: 4 }, () => randomUUID());
const variantIds = Array.from({ length: 4 }, () => randomUUID());
const orderIds = Array.from({ length: 3 }, () => randomUUID());
const itemIds = Array.from({ length: 3 }, () => randomUUID());

await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)", [categoryId, `قسم B ${tag}`, `phase-b-${tag}`]);
for (let index = 0; index < productIds.length; index += 1) {
  await dba.query(`
    INSERT INTO products(id,name,slug,category_id,product_type,unit,is_active)
    VALUES($1,$2,$3,$4,'PIECE','PIECE',true)
  `, [productIds[index], `منتج بديل ${index} ${tag}`, `phase-b-${tag}-${index}`, categoryId]);
  await dba.query(`
    INSERT INTO product_variants(id,product_id,name,price,is_active)
    VALUES($1,$2,$3,$4,true)
  `, [variantIds[index], productIds[index], `عبوة ${index}`, [10, 11, 12.5, 15][index]]);
  await dba.query(`
    INSERT INTO inventory(product_variant_id,quantity,reserved_quantity)
    VALUES($1,20,$2)
  `, [variantIds[index], index === 0 ? 3 : 0]);
}

for (let index = 0; index < orderIds.length; index += 1) {
  await dba.query(`
    INSERT INTO orders(id,order_number,status,subtotal_estimated,discount_total,delivery_fee,total_estimated,
      customer_name_snapshot,customer_phone_snapshot,delivery_city,delivery_phone)
    VALUES($1,$2,'CONFIRMED',10,0,20,30,'عميل B','01000000000','مطاي','01000000000')
  `, [orderIds[index], `HM-20261119-${String((Number(String(Date.now()).slice(-6)) + index) % 1_000_000).padStart(6, "0")}`]);
  await dba.query(`
    INSERT INTO order_items(id,order_id,product_variant_id,product_name_snapshot,variant_name_snapshot,
      unit_snapshot,product_type_snapshot,unit_price,requested_quantity,estimated_total)
    VALUES($1,$2,$3,'المنتج الأصلي','العبوة الأصلية','PIECE','PIECE',10,1,10)
  `, [itemIds[index], orderIds[index], variantIds[0]]);
}

const alternatives = [
  { replacementVariantId: variantIds[1], replacementQuantity: "1", reason: "البديل الأول" },
  { replacementVariantId: variantIds[2], replacementQuantity: "1", reason: "البديل الثاني" },
  { replacementVariantId: variantIds[3], replacementQuantity: "1", reason: "البديل الثالث" },
];

let firstProposal;
let raceProposal;
let rejectProposal;
try {
  await test("three alternatives persist as bounded v1 snapshots with authoritative differences", async () => {
    firstProposal = await proposeReplacement({
      orderId: orderIds[0], orderItemId: itemIds[0], alternatives,
      reason: "ثلاثة بدائل موثقة", markUnavailable: false,
      proposerType: "STAFF", proposerId: actorId,
    });
    const row = (await dba.query("SELECT reason,price_difference::text FROM order_item_replacements WHERE id=$1", [firstProposal])).rows[0];
    const envelope = parseStoredAlternativesEnvelope(row.reason);
    assert.equal(envelope?.version, 1);
    assert.equal(envelope?.alternatives.length, 3);
    assert.deepEqual(envelope?.alternatives.map((item) => item.priceDifference), ["1.00", "2.50", "5.00"]);
    assert.equal(row.price_difference, "1.00");
  });

  await test("customer can pick the second of three and materialization uses server price", async () => {
    await decideReplacement({
      replacementId: firstProposal, expectedOrderId: orderIds[0], outcome: "approve",
      deciderType: "GUEST", deciderId: null, alternativeIndex: 1,
    });
    const row = (await dba.query(`
      SELECT r.status,r.reason,r.price_difference::text,i.product_variant_id::text AS materialized_variant,
             i.unit_price::text,i.estimated_total::text,o.item_status
        FROM order_item_replacements r
        JOIN order_items o ON o.id=r.order_item_id
        JOIN order_items i ON i.id=r.replacement_order_item_id
       WHERE r.id=$1
    `, [firstProposal])).rows[0];
    const envelope = parseStoredAlternativesEnvelope(row.reason);
    assert.equal(row.status, "CUSTOMER_APPROVED");
    assert.equal(row.item_status, "REPLACED");
    assert.equal(row.materialized_variant, variantIds[2]);
    assert.equal(row.unit_price, "12.50");
    assert.equal(row.estimated_total, "12.50");
    assert.equal(envelope?.chosenIndex, 1);
    // After a decision the frozen columns mirror the CHOSEN alternative
    // (index 1 => 12.50 - 10.00), not always alternative #1.
    assert.equal(row.price_difference, "2.50");
  });

  await test("concurrent approve/reject yields one terminal decision and no double materialization", async () => {
    raceProposal = await proposeReplacement({
      orderId: orderIds[1], orderItemId: itemIds[1], alternatives,
      reason: "اختبار قرار متزامن", markUnavailable: false,
      proposerType: "STAFF", proposerId: actorId,
    });
    const settled = await Promise.allSettled([
      decideReplacement({ replacementId: raceProposal, expectedOrderId: orderIds[1], outcome: "approve", deciderType: "GUEST", deciderId: null, alternativeIndex: 2 }),
      decideReplacement({ replacementId: raceProposal, expectedOrderId: orderIds[1], outcome: "reject", deciderType: "GUEST", deciderId: null }),
    ]);
    assert.equal(settled.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(settled.filter((entry) => entry.status === "rejected").length, 1);
    const row = (await dba.query(`
      SELECT status,replacement_order_item_id::text FROM order_item_replacements WHERE id=$1
    `, [raceProposal])).rows[0];
    assert.ok(["CUSTOMER_APPROVED", "CUSTOMER_REJECTED"].includes(row.status));
    const materialized = (await dba.query("SELECT count(*)::int AS n FROM order_items WHERE order_id=$1 AND id<>$2", [orderIds[1], itemIds[1]])).rows[0].n;
    assert.equal(materialized, row.status === "CUSTOMER_APPROVED" ? 1 : 0);
  });

  await test("reject-all is bound to the expected order and cannot cross an IDOR boundary", async () => {
    rejectProposal = await proposeReplacement({
      orderId: orderIds[2], orderItemId: itemIds[2], alternatives,
      reason: "اختبار رفض الكل", markUnavailable: false,
      proposerType: "STAFF", proposerId: actorId,
    });
    await assert.rejects(
      rejectAllProposedReplacements({ expectedOrderId: orderIds[0], orderItemId: itemIds[2], deciderType: "GUEST", deciderId: null }),
      (error) => error?.code === "NOT_FOUND",
    );
    const before = (await dba.query("SELECT item_status FROM order_items WHERE id=$1", [itemIds[2]])).rows[0];
    assert.equal(before.item_status, "PENDING");
    const result = await rejectAllProposedReplacements({
      expectedOrderId: orderIds[2], orderItemId: itemIds[2], deciderType: "GUEST", deciderId: null,
    });
    // Owner decision 2026-11-19: "cancelled/omitted within the order" is the
    // UNAVAILABLE state; the DB transition trigger bans UNAVAILABLE→CANCELLED.
    assert.deepEqual(result, { rejectedProposals: 1, itemStatus: "UNAVAILABLE" });
    const after = (await dba.query("SELECT status FROM order_item_replacements WHERE id=$1", [rejectProposal])).rows[0];
    assert.equal(after.status, "CUSTOMER_REJECTED");
  });
} finally {
  await prisma.$disconnect();
  await dba.end();
  const report = {
    generatedAt: new Date().toISOString(), identity,
    syntheticOnly: true, primaryOrScratchWrites: false,
    total: results.length, passed: results.filter((row) => row.status === "PASS").length,
    failed: results.filter((row) => row.status === "FAIL").length, results,
  };
  writeFileSync("_recovery/v1-ops/evidence/phase-b-postgres-integration.json", JSON.stringify(report, null, 2));
  process.exitCode = report.failed > 0 ? 1 : 0;
}
