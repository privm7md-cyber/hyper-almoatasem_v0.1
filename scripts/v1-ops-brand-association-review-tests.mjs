// Brand association review/apply acceptance on the disposable cluster only.
// Verifies: read-only listing, recomputed proposals, signed preview, explicit
// confirmation, crosswalk gate, existing-brand conflict, archived rejection,
// atomic rollback, audit rows, and batch receipt.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { Client } from "pg";
import { assertDisposableEnvironment } from "./lib/disposable-db-guard.mjs";

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

assertDisposableEnvironment({
  context: "v1-ops-brand-association-review-tests",
  requireKeys: ["DATABASE_URL", "V1_OPS_DATABASE_URL"],
});
const dba = new Client({ connectionString: process.env.V1_OPS_DATABASE_URL });
await dba.connect();
const identity = (await dba.query(`
  SELECT current_database() AS database, inet_server_port() AS port,
         current_setting('data_directory') AS data_directory
`)).rows[0];
assert.equal(identity.database, "hyper_v1_ops_disposable");
assert.equal(identity.port, 55449);
assert.equal(path.resolve(identity.data_directory), path.resolve("_recovery/v1-ops/pgdata"));

const { prisma } = await import("../src/lib/db.ts");
const { listBrandAssociationReviewCandidates, previewOrApplyBrandAssociations } = await import(
  "../src/lib/catalog/brand-association-review.ts"
);

const actorId = process.env.V1_OPS_ADMIN_ID;
assert.ok(actorId, "V1_OPS_ADMIN_ID is required");
const tag = randomUUID().slice(0, 8);
const results = [];
const createdBrandIds = [];
const createdProductIds = [];
const createdCategoryIds = [];

async function rejectWithRowReason(promise, pattern) {
  let settled = false;
  try {
    await promise;
    settled = true;
  } catch (error) {
    const details = error && typeof error === "object" ? error.details : null;
    const rows = details && Array.isArray(details.rows) ? details.rows.join(" | ") : "";
    const text = `${error instanceof Error ? error.message : String(error)} ${rows}`;
    assert.match(text, pattern);
    return;
  }
  if (settled) assert.fail("Expected the operation to be rejected.");
}

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

async function ensureBrand(name, slugSuffix) {
  const existing = await dba.query(
    "SELECT id::text FROM brands WHERE name=$1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1",
    [name],
  );
  if (existing.rowCount) return existing.rows[0].id;
  const id = randomUUID();
  await dba.query("INSERT INTO brands(id,name,slug,is_active) VALUES($1,$2,$3,true)", [
    id,
    name,
    `${slugSuffix}-${tag}`,
  ]);
  createdBrandIds.push(id);
  return id;
}

async function createProduct({ name, brandId = null, archived = false }) {
  const productId = randomUUID();
  const variantId = randomUUID();
  const code = `BR-${tag}-${createdProductIds.length + 1}`;
  await dba.query(
    `INSERT INTO products(id,name,slug,category_id,brand_id,product_type,unit,is_active,deleted_at)
     VALUES($1,$2,$3,$4,$5,'PIECE','PIECE',$6,$7)`,
    [productId, name, `brand-review-${tag}-${createdProductIds.length + 1}`, categoryId, brandId, !archived, archived ? new Date() : null],
  );
  await dba.query("INSERT INTO product_variants(id,product_id,name,price,is_active) VALUES($1,$2,$3,10.00,true)", [
    variantId,
    productId,
    "قطعة",
  ]);
  await dba.query("INSERT INTO product_codes(product_variant_id,code,type,is_primary) VALUES($1,$2,'INTERNAL_CODE',true)", [
    variantId,
    code,
  ]);
  createdProductIds.push(productId);
  return { productId, variantId, code };
}

const categoryId = randomUUID();
createdCategoryIds.push(categoryId);
await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)", [
  categoryId,
  `قسم مراجعة الماركات ${tag}`,
  `brand-review-category-${tag}`,
]);

const exactBrandName = `Exact${tag}`;
const alphaBrandName = `Alpha${tag}`;
const betaBrandName = `Beta${tag}`;
const exactBrandId = await ensureBrand(exactBrandName, "brand-exact");
const alphaBrandId = await ensureBrand(alphaBrandName, "brand-alpha");
const betaBrandId = await ensureBrand(betaBrandName, "brand-beta");
const aliasTargetId = await ensureBrand("Abu Auf", "brand-abu-auf");
const spellingTargetId = await ensureBrand("رحانة", "brand-rahanah");
const genericTargetId = await ensureBrand("الميزان", "brand-al-mizan");

const exact = await createProduct({ name: `${exactBrandName} كولا ${tag}` });
const alias = await createProduct({ name: `ابو عوف بندق ${tag}` });
const spelling = await createProduct({ name: `ريحانه شاي ${tag}` });
const ambiguous = await createProduct({ name: `${alphaBrandName} ${betaBrandName} ${tag}` });
const nonStart = await createProduct({ name: `عبوة ${exactBrandName} ${tag}` });
const generic = await createProduct({ name: `الميزان ارز ${tag}` });
const conflict = await createProduct({ name: `${exactBrandName} قديم ${tag}`, brandId: betaBrandId });
const archived = await createProduct({ name: `${exactBrandName} مؤرشف ${tag}`, archived: true });
const rollback = await createProduct({ name: `${exactBrandName} دفعة ${tag}` });

const reason = "اختبار قبول ربط الماركات على قاعدة معزولة";

try {
  await test("listing recomputes exact/review/ambiguous/unmatched classifications", async () => {
    const listed = await listBrandAssociationReviewCandidates({
      classification: "ALL",
      search: tag,
      brandId: null,
      offset: 0,
      limit: 100,
    });
    const byId = new Map(listed.rows.map((row) => [row.productId, row]));
    assert.equal(byId.get(exact.productId)?.classification, "EXACT_VERIFIED");
    assert.equal(byId.get(alias.productId)?.classification, "REVIEW_REQUIRED");
    assert.equal(byId.get(spelling.productId)?.classification, "REVIEW_REQUIRED");
    assert.equal(byId.get(ambiguous.productId)?.classification, "AMBIGUOUS_CONFLICT");
    assert.equal(byId.get(nonStart.productId)?.classification, "REVIEW_REQUIRED");
    assert.equal(byId.get(generic.productId)?.classification, "REVIEW_REQUIRED");
    assert.equal(byId.get(exact.productId)?.productCode, exact.code);
    assert.ok(listed.summary.totalProducts > 0);
    assert.ok(listed.brands.some((brand) => brand.id === exactBrandId && brand.candidateCount > 0));
  });

  await test("preview is read-only and returns a signed receipt", async () => {
    const preview = await previewOrApplyBrandAssociations(
      { items: [{ productId: exact.productId, brandId: exactBrandId }], reason, dryRun: true },
      actorId,
    );
    assert.equal(preview.applied, false);
    assert.equal(preview.summary.willChange, 1);
    assert.ok(preview.previewReceipt);
    assert.equal(preview.batchReceipt, null);
    const row = await dba.query("SELECT brand_id FROM products WHERE id=$1", [exact.productId]);
    assert.equal(row.rows[0].brand_id, null);
  });

  await test("apply without explicit confirmation is rejected", async () => {
    await assert.rejects(
      previewOrApplyBrandAssociations(
        { items: [{ productId: exact.productId, brandId: exactBrandId }], reason, dryRun: false, confirmed: false },
        actorId,
      ),
      /تأكيد/,
    );
  });

  await test("apply with a tampered brand is rejected and writes nothing", async () => {
    await rejectWithRowReason(
      previewOrApplyBrandAssociations(
        { items: [{ productId: exact.productId, brandId: betaBrandId }], reason, dryRun: true },
        actorId,
      ),
      /لا يطابق الماركة/,
    );
    const row = await dba.query("SELECT brand_id FROM products WHERE id=$1", [exact.productId]);
    assert.equal(row.rows[0].brand_id, null);
  });

  await test("exact apply writes product, per-product audit, batch audit, and receipt", async () => {
    const preview = await previewOrApplyBrandAssociations(
      { items: [{ productId: exact.productId, brandId: exactBrandId }], reason, dryRun: true },
      actorId,
    );
    const applied = await previewOrApplyBrandAssociations(
      {
        items: [{ productId: exact.productId, brandId: exactBrandId }],
        reason,
        dryRun: false,
        confirmed: true,
        previewReceipt: preview.previewReceipt,
      },
      actorId,
    );
    assert.equal(applied.summary.updated, 1);
    assert.ok(applied.batchReceipt);
    assert.match(applied.batchReceipt.batchId, /^[0-9a-f-]{36}$/);
    assert.equal(applied.batchReceipt.changedCount, 1);
    const row = await dba.query("SELECT brand_id::text FROM products WHERE id=$1", [exact.productId]);
    assert.equal(row.rows[0].brand_id, exactBrandId);
    const productAudit = await dba.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action='products.brand_associate' AND entity_id=$1 AND new_values->>'batchId'=$2",
      [exact.productId, applied.batchReceipt.batchId],
    );
    assert.equal(productAudit.rows[0].n, 1);
    const batchAudit = await dba.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action='products.brand_batch' AND entity_id=$1",
      [applied.batchReceipt.batchId],
    );
    assert.equal(batchAudit.rows[0].n, 1);
  });

  await test("re-applying the same association is a no-op", async () => {
    const preview = await previewOrApplyBrandAssociations(
      { items: [{ productId: exact.productId, brandId: exactBrandId }], reason, dryRun: true },
      actorId,
    );
    assert.equal(preview.summary.willChange, 0);
    assert.equal(preview.summary.unchanged, 1);
  });

  await test("alias apply without crosswalk approval is rejected", async () => {
    await rejectWithRowReason(
      previewOrApplyBrandAssociations(
        { items: [{ productId: alias.productId, brandId: aliasTargetId }], reason, dryRun: true },
        actorId,
      ),
      /خريطة الأسماء/,
    );
    const row = await dba.query("SELECT brand_id FROM products WHERE id=$1", [alias.productId]);
    assert.equal(row.rows[0].brand_id, null);
  });

  await test("alias apply with explicit crosswalk approval succeeds", async () => {
    const preview = await previewOrApplyBrandAssociations(
      { items: [{ productId: alias.productId, brandId: aliasTargetId }], reason, dryRun: true, crosswalkApproved: true },
      actorId,
    );
    assert.equal(preview.summary.crosswalkRequired, 1);
    const applied = await previewOrApplyBrandAssociations(
      {
        items: [{ productId: alias.productId, brandId: aliasTargetId }],
        reason,
        dryRun: false,
        confirmed: true,
        crosswalkApproved: true,
        previewReceipt: preview.previewReceipt,
      },
      actorId,
    );
    assert.equal(applied.summary.updated, 1);
    assert.equal(applied.batchReceipt?.crosswalkApproved, true);
    const row = await dba.query("SELECT brand_id::text FROM products WHERE id=$1", [alias.productId]);
    assert.equal(row.rows[0].brand_id, aliasTargetId);
  });

  await test("spelling review apply requires crosswalk approval", async () => {
    await rejectWithRowReason(
      previewOrApplyBrandAssociations(
        { items: [{ productId: spelling.productId, brandId: spellingTargetId }], reason, dryRun: true },
        actorId,
      ),
      /خريطة الأسماء/,
    );
  });

  await test("generic-token row is reviewable without crosswalk but still explicit", async () => {
    const preview = await previewOrApplyBrandAssociations(
      { items: [{ productId: generic.productId, brandId: genericTargetId }], reason, dryRun: true },
      actorId,
    );
    assert.equal(preview.summary.willChange, 1);
    assert.equal(preview.summary.crosswalkRequired, 0);
  });

  await test("ambiguous product is refused", async () => {
    await rejectWithRowReason(
      previewOrApplyBrandAssociations(
        { items: [{ productId: ambiguous.productId, brandId: alphaBrandId }], reason, dryRun: true },
        actorId,
      ),
      /AMBIGUOUS_CONFLICT/,
    );
  });

  await test("existing different brand is never overwritten", async () => {
    await rejectWithRowReason(
      previewOrApplyBrandAssociations(
        { items: [{ productId: conflict.productId, brandId: exactBrandId }], reason, dryRun: true },
        actorId,
      ),
      /مرتبط بالفعل/,
    );
    const row = await dba.query("SELECT brand_id::text FROM products WHERE id=$1", [conflict.productId]);
    assert.equal(row.rows[0].brand_id, betaBrandId);
  });

  await test("archived product is refused", async () => {
    await rejectWithRowReason(
      previewOrApplyBrandAssociations(
        { items: [{ productId: archived.productId, brandId: exactBrandId }], reason, dryRun: true },
        actorId,
      ),
      /مؤرشفة/,
    );
  });

  await test("a mixed valid+invalid batch rolls back completely", async () => {
    await assert.rejects(
      previewOrApplyBrandAssociations(
        {
          items: [
            { productId: rollback.productId, brandId: exactBrandId },
            { productId: ambiguous.productId, brandId: alphaBrandId },
          ],
          reason,
          dryRun: true,
        },
        actorId,
      ),
      /لم يتم تعديل أي منتج/,
    );
    const row = await dba.query("SELECT brand_id FROM products WHERE id=$1", [rollback.productId]);
    assert.equal(row.rows[0].brand_id, null);
  });

  await test("stale preview receipt is rejected after the product name changes", async () => {
    const preview = await previewOrApplyBrandAssociations(
      { items: [{ productId: nonStart.productId, brandId: exactBrandId }], reason, dryRun: true },
      actorId,
    );
    await dba.query("UPDATE products SET name=$2 WHERE id=$1", [nonStart.productId, `${exactBrandName} معدل ${tag}`]);
    await assert.rejects(
      previewOrApplyBrandAssociations(
        {
          items: [{ productId: nonStart.productId, brandId: exactBrandId }],
          reason,
          dryRun: false,
          confirmed: true,
          previewReceipt: preview.previewReceipt,
        },
        actorId,
      ),
      /تغير|Preview|preview/,
    );
  });
} finally {
  if (createdProductIds.length > 0) {
    await dba.query(
      "DELETE FROM product_codes WHERE product_variant_id IN (SELECT id FROM product_variants WHERE product_id = ANY($1::uuid[]))",
      [createdProductIds],
    );
    await dba.query("DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])", [createdProductIds]);
    await dba.query("DELETE FROM products WHERE id = ANY($1::uuid[])", [createdProductIds]);
  }
  if (createdCategoryIds.length > 0) {
    await dba.query("DELETE FROM categories WHERE id = ANY($1::uuid[])", [createdCategoryIds]);
  }
  if (createdBrandIds.length > 0) {
    await dba.query("DELETE FROM brands WHERE id = ANY($1::uuid[])", [createdBrandIds]);
  }
  await prisma.$disconnect();
  await dba.end();
}

const failed = results.filter((result) => result.status === "FAIL");
const payload = {
  verifiedAt: new Date().toISOString(),
  database: identity.database,
  port: identity.port,
  dataDirectory: identity.data_directory,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
};
const evidenceDir = "D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/POST_DE_DATA_GOVERNANCE/Run_20261119_1443/evidence";
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(path.join(evidenceDir, "07-brand-association-review-tests.json"), JSON.stringify(payload, null, 2), "utf8");
mkdirSync("_recovery/v1-ops/evidence", { recursive: true });
writeFileSync("_recovery/v1-ops/evidence/brand-association-review-tests.json", JSON.stringify(payload, null, 2), "utf8");
console.log(`SUMMARY total=${results.length} passed=${payload.passed} failed=${payload.failed}`);
process.exitCode = failed.length ? 1 : 0;
