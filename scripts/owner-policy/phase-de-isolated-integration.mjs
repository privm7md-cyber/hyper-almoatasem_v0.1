// Mutation-heavy Phase D/E integration acceptance. This script refuses every
// database except the dedicated synthetic cluster provisioned by
// scripts/v1-ops-isolated.mjs.
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

assertDisposableEnvironment({ context: "phase-de-isolated-integration", requireKeys: ["DATABASE_URL", "V1_OPS_DATABASE_URL"] });
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
const { createBrand, patchBrand } = await import("../../src/lib/catalog/writes.ts");
const { listBrandsForAdmin } = await import("../../src/lib/catalog/queries.ts");
const { previewOrApplyBulkProductOperation } = await import("../../src/lib/catalog/bulk-operations.ts");
const { listMetadataReviewRows, previewOrApplyMetadataReview } = await import("../../src/lib/catalog/metadata-review.ts");

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
const productId = randomUUID();
const secondProductId = randomUUID();
const variantId = randomUUID();
const rollbackVariantId = randomUUID();
await dba.query("INSERT INTO categories(id,name,slug) VALUES($1,$2,$3)", [categoryId, `قسم D-E ${tag}`, `phase-de-${tag}`]);
await dba.query(`
  INSERT INTO products(id,name,slug,category_id,product_type,unit,is_active)
  VALUES($1,$2,$3,$5,'PIECE','PIECE',true),($4,$6,$7,$5,'PIECE','PIECE',true)
`, [productId, `منتج PhaseD ${tag}`, `phase-d-${tag}`, secondProductId, categoryId, `منتج PhaseE ${tag}`, `phase-e-${tag}`]);
await dba.query(`
  INSERT INTO product_variants(id,product_id,name,price,is_active)
  VALUES($1,$2,'عبوة 500 جم',12.50,true),($3,$4,'عبوة ارتداد',9.00,true)
`, [variantId, productId, rollbackVariantId, secondProductId]);
await dba.query("INSERT INTO product_codes(product_variant_id,code,type,is_primary) VALUES($1,$2,'INTERNAL_CODE',true)", [variantId, `de-${tag}`]);

let brand;
let metadataPreview;
try {
  await test("brand create writes one audit event", async () => {
    brand = await createBrand({ name: `PhaseD ${tag}`, slug: `phase-d-brand-${tag}`, logo: null, isActive: true }, actorId);
    const audit = await dba.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='brands.create' AND entity_id=$1", [brand.id]);
    assert.equal(audit.rows[0].n, 1);
  });

  await test("case/whitespace duplicate brand is rejected without a second row", async () => {
    await assert.rejects(
      createBrand({ name: `  phased   ${tag.toUpperCase()}  `, slug: `phase-d-duplicate-${tag}`, logo: null, isActive: true }, actorId),
      /بنفس الاسم/,
    );
    const rows = await dba.query("SELECT count(*)::int AS n FROM brands WHERE lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=$1", [`phased ${tag}`]);
    assert.equal(rows.rows[0].n, 1);
  });

  await test("admin brand search returns product count and stable cursor page", async () => {
    const beforeAssign = await listBrandsForAdmin({ search: tag, isActive: true, includeDeleted: false, cursor: null, limit: 1 });
    assert.equal(beforeAssign.rows.length, 1);
    assert.equal(beforeAssign.rows[0].productCount, 0);
  });

  await test("bulk brand assignment requires preview receipt then audits apply", async () => {
    const input = { action: "SET_BRAND", productIds: [productId], brandId: brand.id, reason: "ربط موثق اختباري", dryRun: true };
    const preview = await previewOrApplyBulkProductOperation(input, actorId);
    assert.equal(preview.applied, false);
    assert.equal(preview.summary.willChangeCount, 1);
    const before = await dba.query("SELECT brand_id FROM products WHERE id=$1", [productId]);
    assert.equal(before.rows[0].brand_id, null);
    const applied = await previewOrApplyBulkProductOperation({ ...input, dryRun: false, confirmed: true, previewReceipt: preview.previewReceipt }, actorId);
    assert.equal(applied.summary.updatedProductCount, 1);
    const after = await dba.query("SELECT brand_id::text FROM products WHERE id=$1", [productId]);
    assert.equal(after.rows[0].brand_id, brand.id);
  });

  await test("deactivating a referenced brand preserves product association", async () => {
    await patchBrand(brand.id, { isActive: false }, actorId);
    const relation = await dba.query("SELECT brand_id::text FROM products WHERE id=$1", [productId]);
    assert.equal(relation.rows[0].brand_id, brand.id);
  });

  await test("metadata review lists missing fields and preview is read-only", async () => {
    const listed = await listMetadataReviewRows({ issue: "all", search: `PhaseD ${tag}`, cursor: null, limit: 20 });
    assert.ok(listed.rows.some((row) => row.variantId === variantId && row.issues.includes("MISSING_SIZE_UNIT") && row.issues.includes("MISSING_SIZE_VALUE")));
    const preview = await previewOrApplyMetadataReview({ corrections: [{ variantId, sizeValue: "500", sizeUnit: "GRAM" }], reason: "بيان عبوة موثق", dryRun: true }, actorId);
    assert.equal(preview.summary.ready, 1);
    const unchanged = await dba.query("SELECT size_value,size_unit FROM product_variants WHERE id=$1", [variantId]);
    assert.equal(unchanged.rows[0].size_value, null);
    assert.equal(unchanged.rows[0].size_unit, null);
    metadataPreview = preview;
  });

  await test("confirmed metadata apply keeps PIECE selling unit and writes audit", async () => {
    const preview = metadataPreview;
    const applied = await previewOrApplyMetadataReview({
      corrections: [{ variantId, sizeValue: "500", sizeUnit: "GRAM" }], reason: "بيان عبوة موثق",
      dryRun: false, confirmed: true, previewReceipt: preview.previewReceipt,
    }, actorId);
    assert.equal(applied.summary.updated, 1);
    const row = await dba.query("SELECT p.product_type,p.unit,v.size_value::text,v.size_unit FROM products p JOIN product_variants v ON v.product_id=p.id WHERE v.id=$1", [variantId]);
    assert.deepEqual(row.rows[0], { product_type: "PIECE", unit: "PIECE", size_value: "500.000", size_unit: "GRAM" });
    const audit = await dba.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='variants.update' AND entity_id=$1", [variantId]);
    assert.equal(audit.rows[0].n, 1);
  });

  await test("audit failure rolls back metadata row atomically", async () => {
    const preview = await previewOrApplyMetadataReview({ corrections: [{ variantId: rollbackVariantId, sizeValue: "1", sizeUnit: "PIECE" }], reason: "اختبار ارتداد", dryRun: true }, actorId);
    await dba.query(`
      CREATE FUNCTION phase_de_fail_metadata_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='variants.update' THEN RAISE EXCEPTION 'synthetic metadata audit failure'; END IF; RETURN NEW; END $$
    `);
    await dba.query("CREATE TRIGGER phase_de_metadata_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION phase_de_fail_metadata_audit()");
    try {
      await assert.rejects(previewOrApplyMetadataReview({
        corrections: [{ variantId: rollbackVariantId, sizeValue: "1", sizeUnit: "PIECE" }], reason: "اختبار ارتداد",
        dryRun: false, confirmed: true, previewReceipt: preview.previewReceipt,
      }, actorId), /synthetic metadata audit failure/);
      const row = await dba.query("SELECT size_value,size_unit FROM product_variants WHERE id=$1", [rollbackVariantId]);
      assert.equal(row.rows[0].size_value, null);
      assert.equal(row.rows[0].size_unit, null);
    } finally {
      await dba.query("DROP TRIGGER phase_de_metadata_audit_fault ON audit_logs");
      await dba.query("DROP FUNCTION phase_de_fail_metadata_audit()");
    }
  });

  await test("H2 audit rows reject update and delete through app role", async () => {
    await assert.rejects(prisma.$executeRawUnsafe("UPDATE audit_logs SET action=action WHERE entity_id=$1::uuid", brand.id));
    await assert.rejects(prisma.$executeRawUnsafe("DELETE FROM audit_logs WHERE entity_id=$1::uuid", brand.id));
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
  writeFileSync("_recovery/v1-ops/evidence/phase-de-postgres-integration.json", JSON.stringify(report, null, 2));
  process.exitCode = report.failed > 0 ? 1 : 0;
}
