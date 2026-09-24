// ============================================================================
// Hyper Al-Moatasem — PRODUCTION BOOTSTRAP SEED (explicit, fail-closed)
// ============================================================================
// Seeds ONLY the minimal bootstrap data required to run the system, with exact
// values from the authoritative sources `db/phase5-seed-example.sql` (RBAC
// baseline) and the scratch-proven `prisma/seed.mjs` (same constants, same
// drift-loud ensure semantics):
//   roles (2) -> permissions (31) -> role_permissions (31 + 24) ->
//   store_settings (8) -> owner identity (1) -> user_roles (1)
// Everything else (catalog, customers, carts, orders, promotions, ...) is
// BUSINESS DATA and enters later via application/import/admin flows — never here.
//
// Why a separate file: `prisma/seed.mjs` is intentionally Scratch-only and
// hard-denies the production database by live name before any transaction
// begins. That guard must never be weakened (it is the safety harness for all
// scratch/staging work). Production bootstrap is therefore a dedicated,
// explicitly designed path with its own frozen production allowlist.
//
// Driver note: `pg` driver with parameterized SQL (no ORM), same rationale as
// `prisma/seed.mjs`. Data writes only, never DDL. Runs as the runtime role
// (`hyper_app`) via `DATABASE_URL`, which holds DML on the six tables.
//
// Design rules (enforced below, in order):
//  1. DENY by default. Writes happen only when ALL guards pass.
//  2. `BOOTSTRAP_TARGET` must be exactly `production`. Missing/unknown target
//     -> DENY with NO database contact at all. `NODE_ENV` alone never allows
//     anything. There is no force flag, no bypass flag, no override.
//  3. The connected database MUST be `hyper_almoatasem`, asserted from live
//     `current_database()` metadata (never trust env alone). Any other
//     database -> DENY. No arbitrary database names are ever accepted.
//  4. Server MUST be PostgreSQL 18.x (live `server_version`), schema MUST be
//     `public`, structural fingerprint MUST match the frozen post-auth
//     production shape (35 tables / 41 FKs / 165 CHECKs / 11 partials /
//     23 triggers / 6 functions / view / sequence / pgcrypto / GENERATED /
//     INET), ownership MUST be 34x hyper_owner + _prisma_migrations by
//     hyper_migrator, migration history MUST be exactly baseline APPLIED +
//     auth APPLIED (+ the one historical rolled-back row, tolerated
//     explicitly) with zero unfinished rows and zero prototype rows.
//  5. Pre-seed data state MUST be zero across every business table plus
//     zero password hashes and zero auth rows. The six bootstrap tables are
//     verified by the drift-loud ensure path instead, so idempotent reruns
//     stay possible while any business data denies the run.
//  6. Idempotent WITHOUT blind `ON CONFLICT DO NOTHING`: same key/value ->
//     no-op; missing -> INSERT; conflicting core value -> loud FAIL (drift is
//     surfaced, never hidden).
//  7. One transaction (BEGIN/COMMIT, ROLLBACK on any error) for all six steps.
//  8. Never touches `_prisma_migrations`, CHECKs, indexes, triggers,
//     functions, views, sequences, extensions, or GENERATED columns.
//  9. No credentials of any kind: owner identity row carries NO password
//     material (explicit column list excludes password_hash and friends;
//     post-run proof asserts password_hash IS NULL).
//
// Execution (explicit only, never auto-run):
//   BOOTSTRAP_TARGET=production DATABASE_URL=<production-runtime-url> node prisma/bootstrap-production.mjs
//
// Test-only hook: `BOOTSTRAP_FAIL_AFTER=<step>` throws inside the transaction
// right after the named step completes (steps: roles, permissions, grants,
// settings, owner, userRoles), proving atomic rollback. Never set in real runs.
// ============================================================================

import { Client } from "pg";

const PRODUCTION_DB = "hyper_almoatasem";
const BASELINE_MIGRATION = "20260923_baseline__official";
const AUTH_MIGRATION = "20260923_admin_auth_foundation";
const PROTOTYPE_MIGRATION = "00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY";

// The ONLY database this script may ever write to. Frozen by design.
const ALLOWED_DATABASES = [PRODUCTION_DB];

// ---------------------------------------------------------------------------
// Frozen bootstrap data — exact values from db/phase5-seed-example.sql
// (authoritative RBAC baseline), identical to prisma/seed.mjs.
// Fixed UUIDv7 ids keep every run reproducible. Descriptions are human text
// only; keys, names, values, flags and ids are the contract.
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

// Bootstrap owner: identity ONLY. The INSERT column list deliberately excludes
// every auth-credential column (password_hash, failed_login_attempts,
// locked_until); the post-run proof asserts password_hash IS NULL.
const OWNER = {
  id: OWNER_ID,
  name: "System Owner",
  email: "owner@hyper-al-moatasem.local",
  phone: "201000000000",
  isActive: true,
  roleId: SUPER_ADMIN_ID,
};

class BootstrapMismatch extends Error {}

const same = (a, b) => (a ?? null) === (b ?? null);

async function ensureRole(q, expected, report) {
  const byId = (await q(`SELECT id, name, description, is_active FROM roles WHERE id = $1`, [expected.id]))[0];
  if (byId) {
    const bad = ["name", "description"].filter((f) => !same(byId[f], expected[f]));
    if (byId.is_active !== expected.isActive) bad.push("isActive");
    if (bad.length > 0) throw new BootstrapMismatch(`role ${expected.id} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  const byName = (await q(`SELECT id FROM roles WHERE name = $1`, [expected.name]))[0];
  if (byName) throw new BootstrapMismatch(`role name ${expected.name} already mapped to a different id ${byName.id}`);
  await q(`INSERT INTO roles (id, name, description, is_active) VALUES ($1, $2, $3, $4)`,
    [expected.id, expected.name, expected.description, expected.isActive]);
  report.inserted++;
}

async function ensurePermission(q, expected, report) {
  const byId = (await q(`SELECT id, key, description, is_active FROM permissions WHERE id = $1`, [expected.id]))[0];
  if (byId) {
    const bad = ["key", "description"].filter((f) => !same(byId[f], expected[f]));
    if (byId.is_active !== true) bad.push("isActive");
    if (bad.length > 0) throw new BootstrapMismatch(`permission ${expected.id} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  const byKey = (await q(`SELECT id FROM permissions WHERE key = $1`, [expected.key]))[0];
  if (byKey) throw new BootstrapMismatch(`permission key ${expected.key} already mapped to a different id ${byKey.id}`);
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
    if (bad.length > 0) throw new BootstrapMismatch(`setting ${expected.key} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  await q(`INSERT INTO store_settings (id, key, value_text, value_type, description) VALUES ($1, $2, $3, $4, $5)`,
    [expected.id, expected.key, expected.valueText, expected.valueType, expected.description]);
  report.inserted++;
}

async function ensureOwner(q, report) {
  const byId = (await q(`SELECT id, name, email, phone, is_active, password_hash FROM users WHERE id = $1`, [OWNER.id]))[0];
  if (byId) {
    const bad = ["name", "email", "phone"].filter((f) => !same(byId[f], OWNER[f]));
    if (byId.is_active !== OWNER.isActive) bad.push("isActive");
    if (byId.password_hash !== null) bad.push("password_hash(non-null)");
    if (bad.length > 0) throw new BootstrapMismatch(`owner ${OWNER.id} exists with different ${bad.join(",")}`);
    report.existing++;
    return;
  }
  const byEmail = (await q(`SELECT id FROM users WHERE email = $1`, [OWNER.email]))[0];
  if (byEmail) throw new BootstrapMismatch(`owner email ${OWNER.email} already mapped to a different id ${byEmail.id}`);
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
  if (process.env.BOOTSTRAP_FAIL_AFTER === step) {
    throw new Error(`BOOTSTRAP_CHAOS_INJECTED_AFTER_${step}`);
  }
}

function deny(msg) {
  console.error(`BOOTSTRAP_DENIED: ${msg}`);
  process.exit(1);
}

async function main() {
  // Guard 1: explicit production intent, checked BEFORE any database contact.
  // NOTE: NODE_ENV alone is deliberately never sufficient. No force flag exists.
  if (process.env.BOOTSTRAP_TARGET !== "production") {
    deny("missing or invalid BOOTSTRAP_TARGET (expected exactly `production`)");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    deny("DATABASE_URL is missing");
  }
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  const report = {
    target: process.env.BOOTSTRAP_TARGET,
    database: null,
    user: null,
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

    // Guard 2: database identity from live metadata (never trust env alone).
    const meta = (await q(`SELECT current_database() AS db, current_user AS usr, (SELECT setting FROM pg_settings WHERE name = 'server_version') AS ver, (SELECT setting FROM pg_settings WHERE name = 'TimeZone') AS tz`))[0];
    report.database = meta.db;
    report.user = meta.usr;
    if (!ALLOWED_DATABASES.includes(meta.db)) {
      deny(`refusing database ${meta.db} (not the production allowlist)`);
    }
    if (!/^18\./.test(meta.ver)) {
      deny(`refusing PostgreSQL version ${meta.ver} (expected 18.x)`);
    }
    const schema = (await q(`SELECT current_schema() AS s`))[0].s;
    if (schema !== "public") {
      deny(`refusing schema ${schema} (expected public)`);
    }

    // Guard 3: migration history assertion (asserted, never created here).
    // A row counts as unfinished only when it is neither finished nor rolled
    // back: the one historical rolled-back auth row is tolerated explicitly.
    const hist = await q(`SELECT migration_name, finished_at IS NULL AND rolled_back_at IS NULL AS unfinished FROM _prisma_migrations ORDER BY migration_name`);
    const finished = hist.filter((h) => !h.unfinished).map((h) => h.migration_name);
    const unfinished = hist.filter((h) => h.unfinished).map((h) => h.migration_name);
    if (!finished.includes(BASELINE_MIGRATION) || !finished.includes(AUTH_MIGRATION)) {
      deny(`migration history missing applied baseline/auth (found finished: ${finished.join(",")})`);
    }
    if (unfinished.length > 0) {
      deny(`unfinished migrations present: ${unfinished.join(",")}`);
    }
    if (hist.some((h) => h.migration_name === PROTOTYPE_MIGRATION)) {
      deny(`prototype migration present in history`);
    }
    if (hist.length !== 3) {
      deny(`unexpected migration history size ${hist.length} (expected exactly 3 rows: baseline + auth applied + auth rolled-back)`);
    }

    // Guard 4: structural fingerprint (frozen post-auth production shape).
    const fp = (await q(`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name!='_prisma_migrations') AS business_tables,
        (SELECT count(*)::int FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace) AS fks,
        (SELECT count(*)::int FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace) AS checks,
        (SELECT count(*)::int FROM pg_index i JOIN pg_class cl ON cl.oid=i.indexrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND i.indpred IS NOT NULL) AS partials,
        (SELECT count(*)::int FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public') AS triggers,
        (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN ('check_cart_transition','check_order_item_transition','check_order_status_audited','check_replacement_transition','prevent_category_cycle','set_updated_at')) AS funcs,
        (SELECT count(*)::int FROM information_schema.views WHERE table_schema='public' AND table_name='product_stock_status') AS views,
        (SELECT count(*)::int FROM information_schema.sequences WHERE sequence_schema='public' AND sequence_name='order_number_seq') AS seqs,
        (SELECT count(*)::int FROM pg_extension WHERE extname='pgcrypto') AS ext,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory' AND column_name='available_quantity' AND is_generated='ALWAYS') AS gen,
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='ip_address' AND udt_name='inet') AS inet
    `))[0];
    const fpExpected = { business_tables: 34, fks: 41, checks: 165, partials: 11, triggers: 23, funcs: 6, views: 1, seqs: 1, ext: 1, gen: 1, inet: 1 };
    const fpBad = Object.keys(fpExpected).filter((k) => fp[k] !== fpExpected[k]);
    if (fpBad.length > 0) {
      deny(`structural fingerprint mismatch: ${fpBad.map((k) => `${k}=${fp[k]}(expected ${fpExpected[k]})`).join(",")}`);
    }

    // Guard 5: ownership assertion (34x hyper_owner + history by migrator).
    const owners = await q(`SELECT tableowner AS o, count(*)::int AS n FROM pg_tables WHERE schemaname='public' GROUP BY 1 ORDER BY 1`);
    const byOwner = Object.fromEntries(owners.map((r) => [r.o, r.n]));
    const histOwner = (await q(`SELECT tableowner AS o FROM pg_tables WHERE schemaname='public' AND tablename='_prisma_migrations'`))[0]?.o;
    if (byOwner.hyper_owner !== 34 || histOwner !== "hyper_migrator") {
      deny(`ownership mismatch: ${JSON.stringify(owners)}`);
    }

    // Guard 6: pre-seed data state. Every BUSINESS table must be zero (a
    // non-empty business table means wrong database or wrong phase — deny).
    // The six bootstrap tables are deliberately NOT zero-asserted: reruns are
    // idempotent through the drift-loud ensure* checks below, and a strict
    // bootstrap-zero gate would forbid the idempotent second execution.
    // Credential and auth-session rows must always be zero here.
    const zero = (await q(`
      SELECT (SELECT count(*)::int FROM categories) AS categories,
             (SELECT count(*)::int FROM brands) AS brands,
             (SELECT count(*)::int FROM products) AS products,
             (SELECT count(*)::int FROM product_variants) AS product_variants,
             (SELECT count(*)::int FROM product_codes) AS product_codes,
             (SELECT count(*)::int FROM inventory) AS inventory,
             (SELECT count(*)::int FROM inventory_movements) AS inventory_movements,
             (SELECT count(*)::int FROM product_price_history) AS product_price_history,
             (SELECT count(*)::int FROM customers) AS customers,
             (SELECT count(*)::int FROM customer_addresses) AS customer_addresses,
             (SELECT count(*)::int FROM carts) AS carts,
             (SELECT count(*)::int FROM cart_items) AS cart_items,
             (SELECT count(*)::int FROM orders) AS orders,
             (SELECT count(*)::int FROM order_items) AS order_items,
             (SELECT count(*)::int FROM order_status_history) AS order_status_history,
             (SELECT count(*)::int FROM order_item_replacements) AS order_item_replacements,
             (SELECT count(*)::int FROM promotions) AS promotions,
             (SELECT count(*)::int FROM promotion_targets) AS promotion_targets,
             (SELECT count(*)::int FROM promotion_rules) AS promotion_rules,
             (SELECT count(*)::int FROM promotion_buy_get_rules) AS promotion_buy_get_rules,
             (SELECT count(*)::int FROM coupons) AS coupons,
             (SELECT count(*)::int FROM coupon_usages) AS coupon_usages,
             (SELECT count(*)::int FROM order_discounts) AS order_discounts,
             (SELECT count(*)::int FROM audit_logs) AS audit_logs,
             (SELECT count(*)::int FROM notifications) AS notifications,
             (SELECT count(*)::int FROM users WHERE password_hash IS NOT NULL) AS hashes,
             (SELECT count(*)::int FROM admin_sessions) AS sessions,
             (SELECT count(*)::int FROM admin_auth_tokens) AS tokens,
             (SELECT count(*)::int FROM admin_auth_rate_limits) AS ratelimits
    `))[0];
    const zeroBad = Object.keys(zero).filter((k) => zero[k] !== 0);
    if (zeroBad.length > 0) {
      deny(`pre-seed state not zero: ${zeroBad.map((k) => `${k}=${zero[k]}`).join(",")}`);
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

    // Post-commit exact counts (strict: extras/drift/credentials fail loudly here).
    const counts = {
      roles: Number((await q(`SELECT count(*) AS n FROM roles`))[0].n),
      permissions: Number((await q(`SELECT count(*) AS n FROM permissions`))[0].n),
      rolePermissions: Number((await q(`SELECT count(*) AS n FROM role_permissions`))[0].n),
      storeSettings: Number((await q(`SELECT count(*) AS n FROM store_settings`))[0].n),
      users: Number((await q(`SELECT count(*) AS n FROM users`))[0].n),
      userRoles: Number((await q(`SELECT count(*) AS n FROM user_roles`))[0].n),
      passwordHashes: Number((await q(`SELECT count(*) AS n FROM users WHERE password_hash IS NOT NULL`))[0].n),
    };
    const expected = { roles: 2, permissions: 31, rolePermissions: 55, storeSettings: 8, users: 1, userRoles: 1, passwordHashes: 0 };
    const countMismatch = Object.keys(expected).filter((k) => counts[k] !== expected[k]);
    console.log(JSON.stringify({ ...report, counts, expected }, null, 2));
    if (countMismatch.length > 0 || report.extraGrants.length > 0) {
      console.error(`BOOTSTRAP_COUNT_MISMATCH: ${countMismatch.join(",")} extras=${report.extraGrants.length}`);
      process.exit(1);
    }
    console.log("BOOTSTRAP_OK");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`BOOTSTRAP_FAILED: ${e.constructor.name}: ${e.message}`);
  process.exit(1);
});
