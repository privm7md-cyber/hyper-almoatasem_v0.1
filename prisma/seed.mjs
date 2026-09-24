// ============================================================================
// Hyper Al-Moatasem — BOOTSTRAP / SYSTEM SEED (production-quality, explicit only)
// ============================================================================
// Seeds ONLY the minimal bootstrap data required to run the system, with exact
// values from the authoritative source `db/phase5-seed-example.sql`:
//   roles (2) -> permissions (31) -> role_permissions (31 + 24) ->
//   store_settings (8) -> owner identity (1) -> user_roles (1)
// Everything else (catalog, customers, carts, orders, promotions, ...) is
// BUSINESS DATA and enters later via application/import/admin flows — never here.
//
// Driver note: this seed uses the `pg` driver with parameterized SQL (no ORM).
// Rationale: @prisma/client 7.10 requires a driver adapter package
// (@prisma/adapter-pg) that is NOT installed, and adding a dependency needs
// explicit approval — so the seed stays on the already-approved `pg` driver.
// It targets the Prisma-managed schema only (data writes, never DDL).
//
// Design rules (enforced below, in order):
//  1. DENY by default. Writes happen only when ALL guards pass.
//  2. `SEED_TARGET` must be exactly `scratch`. Missing/unknown target -> DENY
//     with NO database contact at all. `NODE_ENV` alone never allows anything.
//  3. The connected database MUST be an explicitly allowlisted scratch database.
//     `hyper_almoatasem` (production) is denied by name, always, before writes.
//  4. Migration history is ASSERTED (`_prisma_migrations` + applied baseline),
//     never created or repaired here. Wrong history -> STOP.
//  5. Idempotent WITHOUT blind `ON CONFLICT DO NOTHING`: same key/value ->
//     no-op; missing -> INSERT; conflicting core value -> loud FAIL (drift is
//     surfaced, never hidden).
//  6. One transaction (BEGIN/COMMIT, ROLLBACK on any error) for all six steps.
//  7. Pure data writes on six tables only. Never touches CHECKs, indexes,
//     triggers, functions, views, sequences, extensions, or GENERATED columns.
//  8. No credentials of any kind: the users table carries identity only (there
//     is no password column until the auth phase lands).
//
// Execution (explicit only, never auto-run):
//   SEED_TARGET=scratch DATABASE_URL=<scratch-url> node prisma/seed.mjs
// (`npx prisma db seed` is intentionally NOT wired: Prisma 7.10 resolves the
// seed command from `migrations.seed` in prisma.config.ts, and this project
// keeps that config minimal by decision — explicit node execution it is.)
//
// Test-only hook: `SEED_FAIL_AFTER=<step>` throws inside the transaction right
// after the named step completes (steps: roles, permissions, grants, settings,
// owner, userRoles), proving atomic rollback. Never set in real runs.
// ============================================================================

import { Client } from "pg";

const BASELINE_MIGRATION = "20260923_baseline__official";

// Scratch databases this seed is allowed to touch. Production
// (`hyper_almoatasem`) can never appear here by construction.
const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  // Auth-foundation scratch: bootstrap owner identity is required there for the
  // owner-password CLI tests. System-seed-only behavior is unchanged.
  "hyper_almoatasem_auth_20260923",
  // Quarantine rerun database (isolated from any concurrent test driver).
  "hyper_almoatasem_authb_20260923",
  // Hardening database (isolated clean rebuild for pre-production gate).
  "hyper_almoatasem_hardening_20260924",
  // Staging database (isolated production-like deployment target).
  "hyper_almoatasem_staging_20260924",
];

const PRODUCTION_DB = "hyper_almoatasem";

// ---------------------------------------------------------------------------
// Frozen bootstrap data — exact values from db/phase5-seed-example.sql.
// Fixed UUIDs keep every run reproducible. Descriptions are human text only;
// keys, names, values, flags and ids are the contract.
// ---------------------------------------------------------------------------

const SUPER_ADMIN_ID = "02800000-0000-7000-8000-000000000001";
const STORE_ADMIN_ID = "02800000-0000-7000-8000-000000000002";
const OWNER_ID = "02800000-0000-7000-8000-000000000010";

const ROLES = [
  {
    id: SUPER_ADMIN_ID,
    name: "SUPER_ADMIN",
    description:
      "Platform/system owner — all grants explicit, no bypass flag",
    isActive: true,
  },
  {
    id: STORE_ADMIN_ID,
    name: "STORE_ADMIN",
    description:
      "Hypermarket owner/operator — all business domains, no platform-security capabilities",
    isActive: true,
  },
];

const PERMISSIONS = [
  { id: "02800000-0000-7000-8000-000000000101", key: "products.view", description: "View catalog products" },
  { id: "02800000-0000-7000-8000-000000000102", key: "products.create", description: "Create catalog products" },
  { id: "02800000-0000-7000-8000-000000000103", key: "products.update", description: "Update catalog products" },
  { id: "02800000-0000-7000-8000-000000000104", key: "products.delete", description: "Disable/remove catalog products" },
  { id: "02800000-0000-7000-8000-000000000105", key: "prices.view", description: "View selling prices" },
  { id: "02800000-0000-7000-8000-000000000106", key: "prices.update", description: "Change selling prices (writes price history)" },
  { id: "02800000-0000-7000-8000-000000000107", key: "inventory.view", description: "View stock levels" },
  { id: "02800000-0000-7000-8000-000000000108", key: "inventory.adjust", description: "Adjust stock (frozen inventory tx + movement)" },
  { id: "02800000-0000-7000-8000-000000000109", key: "orders.view", description: "View orders" },
  { id: "02800000-0000-7000-8000-000000000110", key: "orders.update", description: "Advance/fulfill orders" },
  { id: "02800000-0000-7000-8000-000000000111", key: "orders.cancel", description: "Cancel orders within policy" },
  { id: "02800000-0000-7000-8000-000000000112", key: "customers.view", description: "View customers" },
  { id: "02800000-0000-7000-8000-000000000113", key: "promotions.view", description: "View promotions" },
  { id: "02800000-0000-7000-8000-000000000114", key: "promotions.create", description: "Create promotions" },
  { id: "02800000-0000-7000-8000-000000000115", key: "promotions.update", description: "Update promotions" },
  { id: "02800000-0000-7000-8000-000000000116", key: "promotions.disable", description: "Disable promotions" },
  { id: "02800000-0000-7000-8000-000000000117", key: "coupons.view", description: "View coupons" },
  { id: "02800000-0000-7000-8000-000000000118", key: "coupons.create", description: "Create coupons" },
  { id: "02800000-0000-7000-8000-000000000119", key: "coupons.update", description: "Update coupons" },
  { id: "02800000-0000-7000-8000-000000000120", key: "coupons.disable", description: "Disable coupons" },
  { id: "02800000-0000-7000-8000-000000000121", key: "delivery.view", description: "View delivery state" },
  { id: "02800000-0000-7000-8000-000000000122", key: "delivery.assign", description: "Assign delivery work" },
  { id: "02800000-0000-7000-8000-000000000123", key: "reports.view", description: "View reports" },
  { id: "02800000-0000-7000-8000-000000000124", key: "users.view", description: "View admin users" },
  { id: "02800000-0000-7000-8000-000000000125", key: "users.manage", description: "Provision/disable admin users" },
  { id: "02800000-0000-7000-8000-000000000126", key: "roles.view", description: "View roles" },
  { id: "02800000-0000-7000-8000-000000000127", key: "roles.manage", description: "Manage roles and grants" },
  { id: "02800000-0000-7000-8000-000000000128", key: "settings.view", description: "View store settings" },
  { id: "02800000-0000-7000-8000-000000000129", key: "settings.manage", description: "Change store settings" },
  { id: "02800000-0000-7000-8000-000000000130", key: "audit_logs.view", description: "Read audit trail" },
  { id: "02800000-0000-7000-8000-000000000131", key: "notifications.view", description: "Read own notifications" },
];

// STORE_ADMIN holds everything EXCEPT the platform-security capabilities.
const STORE_ADMIN_EXCLUDED_KEYS = [
  "users.view",
  "users.manage",
  "roles.view",
  "roles.manage",
  "settings.view",
  "settings.manage",
  "audit_logs.view",
];

const SETTINGS = [
  { id: "02800000-0000-7000-8000-000000000201", key: "store.name", valueText: "Hyper Al-Moatasem", valueType: "TEXT", description: "Public store name (Arabic UI renders storefront copy)" },
  { id: "02800000-0000-7000-8000-000000000202", key: "store.phone", valueText: "201000000000", valueType: "TEXT", description: "Public contact phone" },
  { id: "02800000-0000-7000-8000-000000000203", key: "store.email", valueText: "store@hyper-al-moatasem.local", valueType: "TEXT", description: "Public contact email" },
  { id: "02800000-0000-7000-8000-000000000204", key: "currency", valueText: "EGP", valueType: "TEXT", description: "Single operating currency (frozen assumption)" },
  { id: "02800000-0000-7000-8000-000000000205", key: "timezone", valueText: "Africa/Cairo", valueType: "TEXT", description: "Operating timezone" },
  { id: "02800000-0000-7000-8000-000000000206", key: "delivery.enabled", valueText: "false", valueType: "BOOLEAN", description: "Delivery fulfillment switch (delivery phase owns mechanics)" },
  { id: "02800000-0000-7000-8000-000000000207", key: "delivery.default_fee", valueText: "20.00", valueType: "NUMERIC", description: "Default delivery fee applied by future delivery phase" },
  { id: "02800000-0000-7000-8000-000000000208", key: "orders.auto_cancel_minutes", valueText: "30", valueType: "INTEGER", description: "Unpaid-order auto-cancel window (payments phase consumes)" },
];

// Bootstrap owner: identity ONLY. No password/hash/token/session/secret exists
// on the users table (auth arrives with the auth phase), so none is seeded.
const OWNER = {
  id: OWNER_ID,
  name: "System Owner",
  email: "owner@hyper-al-moatasem.local",
  phone: "201000000000",
  isActive: true,
  roleId: SUPER_ADMIN_ID,
};

class SeedMismatch extends Error {}

const same = (a, b) => (a ?? null) === (b ?? null);

async function ensureRole(q, expected, report) {
  const byId = (await q(`SELECT id, name, description, is_active FROM roles WHERE id = $1`, [expected.id]))[0];
  if (byId) {
    const bad = ["name", "description"].filter((f) => !same(byId[f], expected[f]));
    if (byId.is_active !== expected.isActive) bad.push("isActive");
    if (bad.length > 0) throw new SeedMismatch(`role ${expected.id} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  const byName = (await q(`SELECT id FROM roles WHERE name = $1`, [expected.name]))[0];
  if (byName) throw new SeedMismatch(`role name ${expected.name} already mapped to a different id ${byName.id}`);
  await q(`INSERT INTO roles (id, name, description, is_active) VALUES ($1, $2, $3, $4)`,
    [expected.id, expected.name, expected.description, expected.isActive]);
  report.inserted++;
}

async function ensurePermission(q, expected, report) {
  const byId = (await q(`SELECT id, key, description, is_active FROM permissions WHERE id = $1`, [expected.id]))[0];
  if (byId) {
    const bad = ["key", "description"].filter((f) => !same(byId[f], expected[f]));
    if (byId.is_active !== true) bad.push("isActive");
    if (bad.length > 0) throw new SeedMismatch(`permission ${expected.id} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  const byKey = (await q(`SELECT id FROM permissions WHERE key = $1`, [expected.key]))[0];
  if (byKey) throw new SeedMismatch(`permission key ${expected.key} already mapped to a different id ${byKey.id}`);
  await q(`INSERT INTO permissions (id, key, description) VALUES ($1, $2, $3)`,
    [expected.id, expected.key, expected.description]);
  report.inserted++;
}

async function ensureGrant(q, roleId, permissionId, report) {
  const existing = (await q(`SELECT id FROM role_permissions WHERE role_id = $1 AND permission_id = $2`, [roleId, permissionId]))[0];
  if (existing) {
    report.existing++;
    return;
  }
  await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`, [roleId, permissionId]);
  report.inserted++;
}

async function ensureSetting(q, expected, report) {
  const row = (await q(`SELECT id, value_text, value_type, description FROM store_settings WHERE key = $1`, [expected.key]))[0];
  if (row) {
    const bad = [];
    if (!same(row.value_text, expected.valueText)) bad.push("valueText");
    if (!same(row.value_type, expected.valueType)) bad.push("valueType");
    if (!same(row.description, expected.description)) bad.push("description");
    if (row.id !== expected.id) bad.push("id");
    if (bad.length > 0) throw new SeedMismatch(`setting ${expected.key} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  await q(`INSERT INTO store_settings (id, key, value_text, value_type, description) VALUES ($1, $2, $3, $4, $5)`,
    [expected.id, expected.key, expected.valueText, expected.valueType, expected.description]);
  report.inserted++;
}

async function ensureOwner(q, report) {
  const byId = (await q(`SELECT id, name, email, phone, is_active FROM users WHERE id = $1`, [OWNER.id]))[0];
  if (byId) {
    const bad = ["name", "email", "phone"].filter((f) => !same(byId[f], OWNER[f]));
    if (byId.is_active !== OWNER.isActive) bad.push("isActive");
    if (bad.length > 0) throw new SeedMismatch(`owner ${OWNER.id} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  const byEmail = (await q(`SELECT id FROM users WHERE email = $1`, [OWNER.email]))[0];
  if (byEmail) throw new SeedMismatch(`owner email ${OWNER.email} already mapped to a different id ${byEmail.id}`);
  await q(`INSERT INTO users (id, name, email, phone, is_active) VALUES ($1, $2, $3, $4, $5)`,
    [OWNER.id, OWNER.name, OWNER.email, OWNER.phone, OWNER.isActive]);
  report.inserted++;
}

async function ensureUserRole(q, report) {
  const existing = (await q(`SELECT id FROM user_roles WHERE user_id = $1 AND role_id = $2`, [OWNER.id, OWNER.roleId]))[0];
  if (existing) {
    report.existing++;
    return;
  }
  await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [OWNER.id, OWNER.roleId]);
  report.inserted++;
}

function chaos(step) {
  if (process.env.SEED_FAIL_AFTER === step) {
    throw new Error(`SEED_CHAOS_INJECTED_AFTER_${step}`);
  }
}

async function main() {
  // Guard 1: explicit target, checked BEFORE any database contact.
  // NOTE: NODE_ENV alone is deliberately never sufficient.
  if (process.env.SEED_TARGET !== "scratch") {
    console.error("SEED_DENIED: missing or invalid SEED_TARGET (expected exactly `scratch`)");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("SEED_DENIED: DATABASE_URL is missing");
    process.exit(1);
  }
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  const report = {
    target: process.env.SEED_TARGET,
    database: null,
    user: null,
    baseline: BASELINE_MIGRATION,
    roles: { inserted: 0, existing: 0 },
    permissions: { inserted: 0, existing: 0 },
    grants: { inserted: 0, existing: 0 },
    settings: { inserted: 0, existing: 0 },
    owner: { inserted: 0, existing: 0 },
    userRoles: { inserted: 0, existing: 0 },
    extraGrants: [],
  };
  try {
    await client.connect();
    const q = async (sql, params = []) => (await client.query(sql, params)).rows;

    // Guard 2: database assertion from live metadata (never trust env alone).
    const meta = (await q(`SELECT current_database() AS db, current_user AS usr`))[0];
    report.database = meta.db;
    report.user = meta.usr;
    if (meta.db === PRODUCTION_DB) {
      console.error(`SEED_DENIED: refusing production database ${meta.db}`);
      process.exit(1);
    }
    if (!ALLOWED_SCRATCH_DBS.includes(meta.db)) {
      console.error(`SEED_DENIED: unknown database ${meta.db} (not an approved scratch)`);
      process.exit(1);
    }

    // Guard 3: migration history assertion (asserted, never created here).
    const hist = await q(`SELECT migration_name, rolled_back_at FROM public._prisma_migrations WHERE migration_name = $1`, [BASELINE_MIGRATION]);
    if (hist.length === 0 || hist[0].rolled_back_at !== null) {
      console.error(`SEED_STOP: migration history missing or not applied: ${BASELINE_MIGRATION}`);
      process.exit(1);
    }

    // One transaction for all six steps; any mismatch/error rolls everything back.
    await client.query("BEGIN");
    try {
      for (const r of ROLES) await ensureRole(q, r, report.roles);
      chaos("roles");
      for (const p of PERMISSIONS) await ensurePermission(q, p, report.permissions);
      chaos("permissions");
      const permIds = PERMISSIONS.map((p) => p.id);
      for (const pid of permIds) await ensureGrant(q, SUPER_ADMIN_ID, pid, report.grants);
      for (const p of PERMISSIONS.filter((p) => !STORE_ADMIN_EXCLUDED_KEYS.includes(p.key))) {
        await ensureGrant(q, STORE_ADMIN_ID, p.id, report.grants);
      }
      chaos("grants");
      for (const s of SETTINGS) await ensureSetting(q, s, report.settings);
      chaos("settings");
      await ensureOwner(q, report.owner);
      chaos("owner");
      await ensureUserRole(q, report.userRoles);
      chaos("userRoles");

      // Drift visibility: required mappings present above; anything else on
      // these mapping tables is reported, never silently absorbed.
      const requiredPairs = new Set([
        ...permIds.map((pid) => `${SUPER_ADMIN_ID}|${pid}`),
        ...PERMISSIONS.filter((p) => !STORE_ADMIN_EXCLUDED_KEYS.includes(p.key)).map((p) => `${STORE_ADMIN_ID}|${p.id}`),
      ]);
      const actualPairs = await q(`SELECT role_id, permission_id FROM role_permissions`);
      for (const m of actualPairs) {
        if (!requiredPairs.has(`${m.role_id}|${m.permission_id}`)) report.extraGrants.push(m);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }

    // Post-commit exact counts (strict: extras/drift fail loudly here).
    const counts = {
      roles: Number((await q(`SELECT count(*) AS n FROM roles`))[0].n),
      permissions: Number((await q(`SELECT count(*) AS n FROM permissions`))[0].n),
      rolePermissions: Number((await q(`SELECT count(*) AS n FROM role_permissions`))[0].n),
      storeSettings: Number((await q(`SELECT count(*) AS n FROM store_settings`))[0].n),
      users: Number((await q(`SELECT count(*) AS n FROM users`))[0].n),
      userRoles: Number((await q(`SELECT count(*) AS n FROM user_roles`))[0].n),
    };
    const expected = { roles: 2, permissions: 31, rolePermissions: 55, storeSettings: 8, users: 1, userRoles: 1 };
    const countMismatch = Object.keys(expected).filter((k) => counts[k] !== expected[k]);
    console.log(JSON.stringify({ ...report, counts, expected }, null, 2));
    if (countMismatch.length > 0 || report.extraGrants.length > 0) {
      console.error(`SEED_COUNT_MISMATCH: ${countMismatch.join(",")} extras=${report.extraGrants.length}`);
      process.exit(1);
    }
    console.log("SEED_OK");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`SEED_FAILED: ${e.constructor.name}: ${e.message}`);
  process.exit(1);
});
