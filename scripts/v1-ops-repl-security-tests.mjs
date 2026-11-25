// Phase B verification — disposable DB: multi-alt propose/decide/reject-all,
// concurrent decisions, supersede (new propose over open), replay/IDOR guards.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s, c, next) {
  if (s === "server-only") return next(pathToFileURL(path.resolve("vitest.server-only-stub.cjs")).href, c);
  if (s === "next/headers") return next("next/headers.js", c);
  if (s.startsWith("@/")) return next(pathToFileURL(path.resolve("src", s.slice(2) + ".ts")).href, c);
  if ((s.startsWith("./") || s.startsWith("../")) && !path.extname(s) && c?.parentURL) {
    const p = path.resolve(path.dirname(fileURLToPath(c.parentURL)), s);
    if (existsSync(p + ".ts")) return next(pathToFileURL(p + ".ts").href, c);
  }
  return next(s, c);
}});
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";
import { assertDisposableConnection, assertDisposableEnvironment } from "./lib/disposable-db-guard.mjs";
assertDisposableEnvironment({ context: "v1-ops-repl-security-tests", requireKeys: ["DATABASE_URL"] });
const dba = new Client({ connectionString: process.env.V1_OPS_DATABASE_URL ?? process.env.DATABASE_URL });
await dba.connect();
await assertDisposableConnection(dba, { context: "v1-ops-repl-security-tests" });
const { prisma } = await import("../src/lib/db.ts");
const { proposeReplacement, decideReplacement, rejectAllProposedReplacements } = await import("../src/lib/replacements/writes.ts");
const { parseStoredAlternatives } = await import("../src/lib/replacements/validation.ts");
const { getReplacement } = await import("../src/lib/replacements/queries.ts");
const { toReplacement } = await import("../src/lib/replacements/serialize.ts");

const admin = process.env.V1_OPS_ADMIN_ID;
const results = [];
async function test(name, fn) { try { await fn(); results.push({ name, pass: true }); console.log("PASS " + name); } catch (e) { results.push({ name, pass: false, error: e.message }); console.log("FAIL " + name + ": " + e.message); } }

const tag = randomUUID().slice(0, 8);
async function mkCat(name) { const id = randomUUID(); await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)", [id, name, name.replaceAll(" ", "-").toLowerCase() + "-" + tag]); return id; }
async function mkProduct(suffix, name, cat) {
  const id = randomUUID(); const slug = "b-" + suffix + "-" + tag;
  await dba.query("INSERT INTO products(id,name,slug,category_id,product_type,unit,is_active) VALUES($1,$2,$3,$4,'PIECE','PIECE',true)", [id, name, slug, cat]);
  const v1 = randomUUID();
  await dba.query("INSERT INTO product_variants(id,product_id,name,price,is_active) VALUES($1,$2,'v1',11.00,true)", [v1, id]);
  await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'BARCODE')", [v1, "M1-PB-" + suffix + "-" + tag]);
  const v2 = randomUUID();
  await dba.query("INSERT INTO product_variants(id,product_id,name,price,is_active) VALUES($1,$2,'v2',12.50,true)", [v2, id]);
  await dba.query("INSERT INTO product_codes(product_variant_id,code,type) VALUES($1,$2,'BARCODE')", [v2, "M2-PB-" + suffix + "-" + tag]);
  await dba.query("INSERT INTO inventory(product_variant_id,quantity,reserved_quantity) VALUES($1,'10.000',0)", [v1]);
  await dba.query("INSERT INTO inventory(product_variant_id,quantity,reserved_quantity) VALUES($1,'10.000',0)", [v2]);
  return { id, v1, v2 };
}
async function mkOrderWithItem(productId, variantId, qty) {
  const orderId = randomUUID(); const itemId = randomUUID();
  // Reserve the original line as order-create would (BA-3 predicate posture):
  // inventory row created by mkProduct; bump reserved_quantity here.
  await dba.query("UPDATE inventory SET reserved_quantity = reserved_quantity + $1::numeric WHERE product_variant_id = $2", [qty, variantId]);
  const num = "HM-" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") + "-" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const qtyNum = parseFloat(qty);
  const estNum = qtyNum * 2.5;
  await dba.query("INSERT INTO orders(id,order_number,status,customer_name_snapshot,customer_phone_snapshot,delivery_city,delivery_phone,total_estimated,subtotal_estimated) VALUES($1,$2,'PREPARING','ك', '525000000000', 'القاهرة', '5250000000', $3, $3)", [orderId, num, estNum]);
  await dba.query(`INSERT INTO order_items (id, order_id, product_variant_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, product_type_snapshot, unit_price, requested_quantity, estimated_total, item_status)
    VALUES ($1, $2, $3, 'p', 'v', 'PIECE', 'PIECE', 2.50, $4, $5, 'PENDING')`, [itemId, orderId, variantId, qty, estNum]);
  return { orderId, itemId };
}

const cat = await mkCat("catPb");
const pA = await mkProduct("a", "البديل الأول-" + tag, cat);
const pB = await mkProduct("b", "البديل الثاني-" + tag, cat);
const pC = await mkProduct("c", "البديل الثالث-" + tag, cat);

try {
  await test("B1: multi-alt propose — 3 alternatives, stored in reason JSON, singular = alt #1", async () => {
    const { orderId, itemId } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const altB = { replacementVariantId: pB.v2, replacementQuantity: "3", reason: "رخصة البديل قليلة" };
    const altC = { replacementVariantId: pC.v2, replacementQuantity: "1", reason: "بديل بسيط" };
    const id = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pB.v1, replacementQuantity: "2", reason: "رخصة نفسها" }, altB, altC],
      reason: "الصنف خلص من المخزن", markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    assert.ok(id);
    const full = await getReplacement(id);
    assert.equal(full.status, "PROPOSED");
    assert.equal(full.originalItem.itemStatus, "UNAVAILABLE");
    assert.equal(full.replacementVariantId, pB.v1);
    const stored = parseStoredAlternatives(full.reason);
    assert.equal(stored.length, 3);
    assert.equal(stored[0].variantId, pB.v1);
    assert.equal(stored[1].variantId, pB.v2);
    assert.equal(stored[1].reason, "رخصة البديل قليلة");
    assert.ok(full.priceDifference !== undefined);
    const shape = toReplacement(full);
    assert.equal(shape.alternatives.length, 3);
    assert.equal(shape.alternatives[0].chosen, false); // pending — nobody chose yet
    assert.ok(shape.alternatives.every((a) => a.quantity !== ""));
  });

  await test("B2: choose the SECOND alternative — approve with alternativeIndex=1, item replaced, totals recomputed", async () => {
    const { orderId, itemId } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const id = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [
        { replacementVariantId: pB.v1, replacementQuantity: "2", reason: null },
        { replacementVariantId: pC.v2, replacementQuantity: "5", reason: "البديل الثاني" },
      ],
      markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    const approved = await decideReplacement({ replacementId: id, expectedOrderId: orderId, outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 1 });
    const full = await getReplacement(id);
    assert.equal(full.status, "CUSTOMER_APPROVED");
    assert.equal(full.decidedByType, "CUSTOMER");
    const mat = await dba.query("SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND id <> $2 AND product_variant_id=$3", [orderId, itemId, pC.v2]);
    assert.equal(mat.rows[0].n, 1);
    assert.equal(approved, id);
    // Chosen alternative (not alt #1) must own the singular columns + the
    // materialized line must carry authoritative line math.
    const rec = await dba.query("SELECT replacement_variant_id::text AS v, replacement_quantity::text AS q, replacement_unit_price::text AS p, price_difference::text AS d FROM order_item_replacements WHERE id=$1", [id]);
    assert.equal(rec.rows[0].v, pC.v2);
    assert.equal(rec.rows[0].q, "5.000");
    assert.equal(rec.rows[0].p, "12.50");
    assert.equal(rec.rows[0].d, "57.50"); // 5 × 12.50 = 62.50 minus original 5.00
    const line = await dba.query("SELECT unit_price::text AS p, estimated_total::text AS t FROM order_items WHERE order_id=$1 AND product_variant_id=$2", [orderId, pC.v2]);
    assert.equal(line.rows[0].p, "12.50");
    assert.equal(line.rows[0].t, "62.50");
  });

  await test("B3: reject-all — line marked UNAVAILABLE (omitted), proposals flipped, catalog product intact", async () => {
    const prodBefore = await dba.query("SELECT count(*)::int n FROM products WHERE id=$1", [pA.id]);
    assert.equal(prodBefore.rows[0].n, 1);
    const { orderId, itemId } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const id = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pB.v1, replacementQuantity: "2", reason: null }],
      markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    const res = await rejectAllProposedReplacements({ expectedOrderId: orderId, orderItemId: itemId, deciderType: "CUSTOMER", deciderId: randomUUID() });
    assert.equal(res.itemStatus, "UNAVAILABLE");
    assert.equal(res.rejectedProposals, 1);
    const item = await dba.query("SELECT item_status FROM order_items WHERE id=$1", [itemId]);
    assert.equal(item.rows[0].item_status, "UNAVAILABLE"); // omitted; catalog product untouched
    const rep = await dba.query("SELECT status FROM order_item_replacements WHERE id=$1", [id]);
    assert.equal(rep.rows[0].status, "CUSTOMER_REJECTED");
    const prodAfter = await dba.query("SELECT count(*)::int n FROM products WHERE id=$1", [pA.id]);
    assert.equal(prodAfter.rows[0].n, 1); // catalog product untouched
  });

  await test("B4: guarded decisions — double-approve 409s, bad index 409s, wrong-order 409s, reject path", async () => {
    // B4a: double-approve on an approved replacement → 409 "no longer open".
    const { orderId, itemId } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const id = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pB.v1, replacementQuantity: "2", reason: null }],
      markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    await decideReplacement({ replacementId: id, expectedOrderId: orderId, outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 0 });
    await assert.rejects(() => decideReplacement({ replacementId: id, expectedOrderId: orderId, outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 0 }), /no longer open/);

    // B4b: invalid alternativeIndex → 409 "The chosen alternative is no longer available."
    const { orderId: o2, itemId: i2 } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const id2 = await proposeReplacement({
      orderId: o2, orderItemId: i2,
      alternatives: [{ replacementVariantId: pB.v1, replacementQuantity: "2", reason: null }],
      markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    await assert.rejects(() => decideReplacement({ replacementId: id2, expectedOrderId: o2, outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 3 }), /no longer available|chosen alternative/);

    // B4c: wrong order id → 409 (NOT_FOUND).
    await assert.rejects(() => decideReplacement({ replacementId: id2, expectedOrderId: randomUUID(), outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 0 }), /not found/i);

    // B4d: reject path — decide(reject) flips to CUSTOMER_REJECTED; double-reject → 409.
    const r2 = await decideReplacement({ replacementId: id2, expectedOrderId: o2, outcome: "reject", deciderType: "CUSTOMER", deciderId: randomUUID() });
    assert.equal(r2, id2);
    await assert.rejects(() => decideReplacement({ replacementId: id2, expectedOrderId: o2, outcome: "reject", deciderType: "CUSTOMER", deciderId: randomUUID() }), /no longer open/);
  });

  await test("B5: supersede — re-propose over an open proposal → 409 (one open proposal per item); new propose after deciding works", async () => {
    const { orderId, itemId } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const id1 = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pB.v1, replacementQuantity: "2", reason: null }],
      markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    await assert.rejects(() => proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pC.v2, replacementQuantity: "4", reason: null }],
      markUnavailable: false, proposerType: "STAFF", proposerId: admin,
    }), /A proposal is already open for this line/);
    const res = await rejectAllProposedReplacements({ expectedOrderId: orderId, orderItemId: itemId, deciderType: "CUSTOMER", deciderId: randomUUID() });
    assert.equal(res.itemStatus, "UNAVAILABLE");
    // After deciding, a new proposal is allowed again (swap mode, stays PENDING).
    const id2 = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pC.v2, replacementQuantity: "4", reason: null }],
      markUnavailable: false, proposerType: "STAFF", proposerId: admin,
    });
    assert.ok(id2 && id2 !== id1);
    const open = await dba.query("SELECT count(*)::int n FROM order_item_replacements WHERE order_item_id=$1 AND status='PROPOSED'", [itemId]);
    assert.equal(open.rows[0].n, 1);
    const rep1 = await dba.query("SELECT status FROM order_item_replacements WHERE id=$1", [id1]);
    assert.equal(rep1.rows[0].status, "CUSTOMER_REJECTED");
  });

  await test("B6: concurrency — one of two parallel decisions wins; one of two parallel proposals opens", async () => {
    // Two simultaneous approvals on the same proposal: row lock + PROPOSED
    // gate must let exactly one materialize; the loser gets 409 semantics.
    const { orderId, itemId } = await mkOrderWithItem(pA.id, pA.v1, "2.000");
    const id = await proposeReplacement({
      orderId, orderItemId: itemId,
      alternatives: [{ replacementVariantId: pC.v2, replacementQuantity: "1", reason: null }],
      markUnavailable: true, proposerType: "STAFF", proposerId: admin,
    });
    const decisions = await Promise.allSettled([
      decideReplacement({ replacementId: id, expectedOrderId: orderId, outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 0 }),
      decideReplacement({ replacementId: id, expectedOrderId: orderId, outcome: "approve", deciderType: "CUSTOMER", deciderId: randomUUID(), alternativeIndex: 0 }),
    ]);
    const won = decisions.filter((r) => r.status === "fulfilled");
    const lost = decisions.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.match(String(lost[0].reason?.message), /no longer open/);
    const lines = await dba.query("SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND product_variant_id=$2", [orderId, pC.v2]);
    assert.equal(lines.rows[0].n, 1); // exactly one substitute line

    // Two simultaneous proposes on a fresh line: partial unique index must
    // keep exactly one open proposal.
    const { orderId: o2, itemId: i2 } = await mkOrderWithItem(pA.id, pA.v1, "1.000");
    const proposals = await Promise.allSettled([
      proposeReplacement({ orderId: o2, orderItemId: i2, alternatives: [{ replacementVariantId: pC.v2, replacementQuantity: "1", reason: null }], markUnavailable: true, proposerType: "STAFF", proposerId: admin }),
      proposeReplacement({ orderId: o2, orderItemId: i2, alternatives: [{ replacementVariantId: pB.v2, replacementQuantity: "1", reason: null }], markUnavailable: true, proposerType: "STAFF", proposerId: admin }),
    ]);
    assert.equal(proposals.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(proposals.filter((r) => r.status === "rejected").length, 1);
    const lostProposal = proposals.find((r) => r.status === "rejected");
    assert.match(String(lostProposal.reason?.message), /already open/);
    const open = await dba.query("SELECT count(*)::int n FROM order_item_replacements WHERE order_item_id=$1 AND status='PROPOSED'", [i2]);
    assert.equal(open.rows[0].n, 1);
  });
} finally {
  await prisma.$disconnect(); await dba.end();
  writeFileSync("_recovery/v1-ops/evidence/repl-security-tests.json", JSON.stringify({ db: "hyper_v1_ops_disposable", total: results.length, failed: results.filter((r) => !r.pass).length, results }, null, 2));
  process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
}
import { writeFileSync } from "node:fs";
