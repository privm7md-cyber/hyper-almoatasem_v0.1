// Idempotent owner-brand installation. Creates only unambiguous labels and
// never assigns products. Default mode is dry-run; Primary apply requires the
// explicit --apply --confirm-primary=hyper_almoatasem pair.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { buildOwnerBrandManifest } from "../../src/lib/catalog/brand-management.ts";

const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm-primary="))?.split("=")[1] ?? null;
const receiptIndex = process.argv.indexOf("--receipt");
const receiptPath = receiptIndex >= 0 ? process.argv[receiptIndex + 1] : null;

function uuidV7(nowMs = Date.now()) {
  const rand = randomBytes(10);
  const timeHex = nowMs.toString(16).padStart(12, "0");
  const b = [
    ...[0, 1, 2, 3, 4, 5].map((i) => Number.parseInt(timeHex.slice(i * 2, i * 2 + 2), 16)),
    0x70 | (rand[0] & 0x0f), rand[1], 0x80 | (rand[2] & 0x3f),
    rand[3], rand[4], rand[5], rand[6], rand[7], rand[8], rand[9],
  ];
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function slugify(raw) {
  return raw.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9\u0600-\u06FF_-]/gu, "")
    .replace(/-+/g, "-");
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const identity = (await db.query(`
  SELECT current_database() AS database, current_user AS role,
         has_table_privilege(current_user, 'public.brands', 'INSERT') AS can_insert_brands,
         has_table_privilege(current_user, 'public.audit_logs', 'INSERT') AS can_insert_audit,
         has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects
`)).rows[0];
if (identity.database !== "hyper_almoatasem") throw new Error(`Refused: expected hyper_almoatasem, got ${identity.database}`);
if (!identity.can_insert_brands || !identity.can_insert_audit) throw new Error("Refused: role lacks required brand/audit INSERT permission.");
if (apply && confirmation !== identity.database) throw new Error("Refused: apply requires --confirm-primary=hyper_almoatasem.");

const manifest = buildOwnerBrandManifest();
const candidates = manifest.filter((row) => row.disposition === "INSTALL");
const before = (await db.query(`SELECT
  (SELECT COUNT(*)::int FROM brands) AS brands,
  (SELECT COUNT(*)::int FROM products) AS products,
  (SELECT COUNT(*)::int FROM products WHERE brand_id IS NOT NULL) AS branded_products,
  (SELECT COUNT(*)::int FROM audit_logs WHERE entity_type='brands') AS brand_audits
`)).rows[0];
const plan = [];
for (const candidate of candidates) {
  const existing = (await db.query(`
    SELECT id::text, name, slug
    FROM brands
    WHERE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) = $1
    LIMIT 1
  `, [candidate.normalizedDuplicateKey])).rows[0] ?? null;
  const slug = slugify(candidate.rawName);
  const slugConflict = existing ? null : (await db.query("SELECT id::text, name, slug FROM brands WHERE slug=$1 LIMIT 1", [slug])).rows[0] ?? null;
  plan.push({ ...candidate, slug, status: existing ? "ALREADY_PRESENT" : slugConflict ? "CONFLICT" : "CREATE", existing, slugConflict });
}
if (plan.some((row) => row.status === "CONFLICT")) throw new Error("Refused: one or more generated slugs conflict with a different stored brand.");

const created = [];
if (apply) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(88421031)");
    for (const row of plan.filter((item) => item.status === "CREATE")) {
      const concurrent = (await db.query(`
        SELECT id::text, name FROM brands
        WHERE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))=$1 OR slug=$2
        LIMIT 1
      `, [row.normalizedDuplicateKey, row.slug])).rows[0] ?? null;
      if (concurrent) throw new Error(`Concurrent brand conflict for '${row.rawName}'.`);
      const id = uuidV7();
      await db.query(`INSERT INTO brands (id,name,slug,is_active) VALUES ($1::uuid,$2,$3,true)`, [id, row.rawName, row.slug]);
      await db.query(`
        INSERT INTO audit_logs (user_id,actor_type,action,entity_type,entity_id,old_values,new_values)
        VALUES (NULL,'SYSTEM','brands.create','brands',$1::uuid,NULL,$2::jsonb)
      `, [id, JSON.stringify({ name: row.rawName, slug: row.slug, source: "OWNER_POLICY_UPDATE_20261119", productAssignments: 0 })]);
      created.push({ id, name: row.rawName, slug: row.slug, rollback: "DEACTIVATE_ONLY" });
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

const after = (await db.query(`SELECT
  (SELECT COUNT(*)::int FROM brands) AS brands,
  (SELECT COUNT(*)::int FROM products) AS products,
  (SELECT COUNT(*)::int FROM products WHERE brand_id IS NOT NULL) AS branded_products,
  (SELECT COUNT(*)::int FROM audit_logs WHERE entity_type='brands') AS brand_audits
`)).rows[0];
const receipt = {
  generatedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY_RUN",
  identity,
  authorizationScope: "Create unambiguous owner labels only; no product assignment; no DDL; no role changes.",
  before,
  after,
  summary: {
    supplied: manifest.length,
    reviewHeldOut: manifest.filter((row) => row.disposition === "REVIEW_REQUIRED").length,
    plannedCreate: plan.filter((row) => row.status === "CREATE").length,
    alreadyPresent: plan.filter((row) => row.status === "ALREADY_PRESENT").length,
    created: created.length,
  },
  created,
  rollbackManifest: {
    strategy: "Deactivate inserted rows; never delete audit history or referenced brands.",
    rows: created.map((row) => ({ id: row.id, name: row.name, action: "UPDATE brands SET is_active=false" })),
  },
  heldForReview: manifest.filter((row) => row.disposition === "REVIEW_REQUIRED"),
  plan,
};
await db.end();
const text = `${JSON.stringify(receipt, null, 2)}\n`;
if (receiptPath) writeFileSync(receiptPath, text, "utf8");
process.stdout.write(text);
