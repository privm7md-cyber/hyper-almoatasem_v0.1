#!/usr/bin/env node
// ============================================================================
// FRESH DATABASE BOOTSTRAP — the safe, re-runnable path from EMPTY to COMPLETE.
//
// WHY THIS SCRIPT EXISTS (D10)
//   `prisma migrate deploy` is UNSAFE on an empty database in this repository:
//
//     1. `prisma/migrations/00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY/`
//        sorts FIRST lexicographically, and Prisma applies pending migrations
//        in name order — so the PROTOTYPE would be applied before the official
//        baseline. First-party proof: `prisma migrate status` reports it as
//        "not yet applied" next to the residual migration.
//        The prototype is a planning artifact whose own README says
//        "Never marked applied" and "DO NOT APPLY". It is NOT deleted or
//        renamed here (owner constraint) — this script simply never applies it.
//
//     2. Prisma applies only `migration.sql`. Every `supplement.sql` — which
//        owns the SQL-only integrity (CHECK constraints, trigger functions,
//        triggers, partial indexes, the view, the sequence, pgcrypto) — would
//        be silently skipped, leaving a database that LOOKS migrated but has
//        none of the frozen integrity rules.
//
//   The authoritative schema source is therefore the ORDERED MIGRATION CHAIN
//   below, applied as (migration.sql, supplement.sql) pairs, with a
//   hash-auditable ledger.
//
// SAFETY GUARDS (fail-closed, checked before ANY contact beyond the identity probe)
//   * The target database name must match `hyper_almoatasem_[a-z0-9_]+`.
//   * Production / preview / prior-phase-evidence databases are refused by
//     name (see DENIED_DATABASES) — they can never be targeted.
//   * The connected role must be `hyper_migrator` (least privilege).
//   * `current_database()` must equal the requested database (runtime identity
//     proof; the env var is never trusted on its own).
//   * When targeting the `public` schema, the database must be EMPTY of
//     application tables (a shared/populated database is refused).
//   * When targeting a dedicated schema, that schema must not already exist
//     with application objects (refuse unless --adopt-existing is passed).
//   * The database must NOT have a C/POSIX collation. Under a C ctype pg_trgm
//     drops every non-ASCII character, so Arabic trigram similarity is 0 and
//     the catalog's typo/brand recall arms are silently dead.
//
// LEDGER
//   * `bootstrap_ledger` — one row per applied artifact with the SHA-256 of
//     the exact bytes applied (re-runnability + tamper evidence).
//   * `_prisma_migrations` — Prisma-compatible history so the Prisma toolchain
//     sees the same state. The prototype row is recorded as ROLLED BACK
//     (`finished_at IS NULL`, `rolled_back_at IS NOT NULL`) — the honest marker
//     for "never applied" — which is exactly why `prisma migrate deploy` must
//     never be used on this repository.
//
// USAGE
//   node scripts/bootstrap-fresh-db.mjs --db <name> [--schema <name>]
//        [--adopt-existing] [--verify-only] [--json]
//
// No secrets are read, printed, or required beyond the already-configured
// MIGRATION_DATABASE_URL.
// ============================================================================
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "pg";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");

// --- The authoritative chain, in order. Explicit (not glob-discovered) so a
// --- new folder can never be applied without an explicit code change.
// --- Each entry: [migration.sql, supplement.sql] applied in that order.
const CHAIN = [
  "20260923_baseline__official",
  "20260923_admin_auth_foundation",
  "20261006_customer_auth",
  "20261006_catalog_media_search",
  "20261008_guest_orders",
  "20261029_residual_delivery_guest_recovery",
  "20261101_audit_tamper_protection",
];

// Never applied. Kept on disk (owner constraint: never delete/rename).
const PROTOTYPE = "00000000000000_baseline__PROTOTYPE_DO_NOT_APPLY";

const DENIED_DATABASES = new Set([
  "hyper_almoatasem", // production
  "hyper_almoatasem_p09", // prior-phase evidence
  "hyper_almoatasem_p10", // prior-phase evidence
  "hyper_almoatasem_p10r", // prior-phase evidence
  "hyper_almoatasem_p11", // prior-phase evidence
  "postgres",
]);

const REQUIRED_ROLE = "hyper_migrator";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const dbName = flag("db");
const schemaName = flag("schema") || "public";
const adoptExisting = has("adopt-existing");
const verifyOnly = has("verify-only");
const asJson = has("json");

const log = (...args) => {
  if (!asJson) console.log(...args);
};

function refuse(reason, extra = {}) {
  console.error(`REFUSED: ${reason}`);
  if (Object.keys(extra).length > 0) console.error(JSON.stringify(extra));
  process.exit(1);
}

if (!dbName) refuse("USAGE — --db <name> is required");
if (!/^hyper_almoatasem_[a-z0-9_]+$/.test(dbName)) {
  refuse(`database name does not match the isolated-target pattern: ${dbName}`);
}
if (DENIED_DATABASES.has(dbName)) refuse(`target database is on the deny list: ${dbName}`);
if (/preview/i.test(dbName)) refuse(`preview databases are never bootstrap targets: ${dbName}`);
if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) refuse(`invalid schema name: ${schemaName}`);

const sourceUrl = process.env.MIGRATION_DATABASE_URL;
if (!sourceUrl) refuse("MIGRATION_DATABASE_URL is missing");

const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${dbName}`;
targetUrl.search = "";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const main = async () => {
  const client = new Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();

  // ---------------------------------------------------------------- identity
  const identity = await client.query(`
    SELECT current_database()   AS database,
           current_user          AS role,
           inet_server_addr()::text AS server_addr,
           inet_server_port()    AS server_port,
           current_setting('server_version') AS server_version,
           current_schema()      AS current_schema
  `);
  const id = identity.rows[0];
  if (id.database !== dbName) {
    await client.end();
    refuse(`runtime identity mismatch: connected to "${id.database}", requested "${dbName}"`);
  }
  if (id.role !== REQUIRED_ROLE) {
    await client.end();
    refuse(`the bootstrap must run as ${REQUIRED_ROLE}, connected as "${id.role}"`);
  }

  const identityProof = {
    database: id.database,
    role: id.role,
    server_addr: id.server_addr,
    server_port: id.server_port,
    server_version: id.server_version,
    schema: schemaName,
  };
  log("IDENTITY_PROOF", JSON.stringify(identityProof));

  // ------------------------------------------------------------- collation
  // The database collation is part of the schema contract, not a cosmetic
  // default. pg_trgm extracts trigrams with the DATABASE's character
  // classification, and under a C/POSIX ctype every non-ASCII character is
  // dropped: the Arabic fold in `hyper_norm_ar` then produced an EMPTY
  // trigram set, so `similarity('بيسبي','بيبسي')` measured 0 instead of
  // the 0.20 that the search tuning constant (SEARCH_MIN_SIMILARITY = 0.2)
  // is calibrated against — tier-1 (typo) and tier-0 (brand/category)
  // recall were silently dead and the functional GIN index was never
  // applicable. Refuse such a target instead of bootstrapping a database
  // whose Arabic catalog search cannot work.
  const collation = (
    await client.query(`
      SELECT d.datcollate, d.datctype, d.datlocprovider,
             pg_encoding_to_char(d.encoding) AS encoding
        FROM pg_database d
       WHERE d.datname = current_database()
    `)
  ).rows[0];
  const collationIsC =
    ["C", "POSIX"].includes(String(collation.datcollate)) ||
    ["C", "POSIX"].includes(String(collation.datctype));
  if (collationIsC) {
    await client.end();
    refuse(
      `the target database has a C/POSIX collation (datcollate="${collation.datcollate}", datctype="${collation.datctype}"); Arabic pg_trgm similarity is 0 under it, so the catalog's typo and brand/category recall silently return nothing. Recreate the database with a UTF-8-aware locale (scripts/create-scratch-db.mjs) and re-run the bootstrap.`,
      { collation },
    );
  }
  identityProof.collation = collation;
  log("COLLATION", JSON.stringify(collation));

  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

  // ------------------------------------------------------------- emptiness
  const schemaExists = await one("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1", [schemaName]);
  if (schemaExists.n === 0 && schemaName !== "public") {
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO hyper_app`);
    log(`SCHEMA_CREATED ${schemaName}`);
  }
  await client.query(`SET search_path TO "${schemaName}", public`);

  const appTables = await q(`
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r','p')
       AND c.relname <> '_prisma_migrations'
       AND c.relname <> 'bootstrap_ledger'
     ORDER BY 1
  `, [schemaName]);

  if (appTables.length > 0 && !adoptExisting && !verifyOnly) {
    await client.end();
    refuse(
      `target schema "${schemaName}" already holds ${appTables.length} application table(s); re-run with --adopt-existing only after inspecting the ledger`,
      { tables: appTables.map((r) => r.relname) },
    );
  }
  log(`TARGET_SCHEMA "${schemaName}" app_tables=${appTables.length}`);

  // --------------------------------------------------------------- ledger
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".bootstrap_ledger (
      id            SERIAL PRIMARY KEY,
      migration_name TEXT NOT NULL,
      artifact      TEXT NOT NULL UNIQUE,
      sha256        VARCHAR(64) NOT NULL,
      applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_by    TEXT NOT NULL DEFAULT current_user
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${schemaName}"._prisma_migrations (
      id TEXT PRIMARY KEY,
      checksum VARCHAR(64),
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255),
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  const alreadyApplied = new Set(
    (await q(`SELECT artifact FROM "${schemaName}".bootstrap_ledger`)).map((r) => r.artifact),
  );

  // ------------------------------------------------------- apply the chain
  const applied = [];
  const skipped = [];
  const failed = [];

  for (const migration of CHAIN) {
    const dir = path.join(MIGRATIONS_DIR, migration);
    if (!fs.existsSync(dir)) {
      failed.push({ migration, artifact: "dir", error: "missing migration directory" });
      continue;
    }
    for (const artifact of ["migration.sql", "supplement.sql"]) {
      const file = path.join(dir, artifact);
      if (!fs.existsSync(file)) {
        failed.push({ migration, artifact, error: "missing artifact" });
        continue;
      }
      const key = `${migration}/${artifact}`;
      if (alreadyApplied.has(key)) {
        skipped.push(key);
        continue;
      }
      if (verifyOnly) {
        skipped.push(`${key} (verify-only)`);
        continue;
      }
      const bytes = fs.readFileSync(file);
      const digest = sha256(bytes);
      const sql = bytes.toString("utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO "${schemaName}".bootstrap_ledger (migration_name, artifact, sha256) VALUES ($1, $2, $3)`,
          [migration, key, digest],
        );
        await client.query("COMMIT");
        applied.push({ migration, artifact, sha256: digest });
        log(`APPLIED ${key} sha256=${digest.slice(0, 12)}…`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        failed.push({ migration, artifact, error: error?.message });
        log(`FAILED ${key}: ${error?.message}`);
      }
    }
  }

  // The prototype: recorded as NEVER APPLIED (rolled back marker). Honest, and
  // it keeps `prisma migrate deploy` from being the only way to reach a
  // complete schema.
  if (!alreadyApplied.has(`${PROTOTYPE}/migration.sql`) && !verifyOnly) {
    await client.query(
      `INSERT INTO "${schemaName}"._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, applied_steps_count)
       VALUES ($1, NULL, NULL, $2, $3, now(), 0)
       ON CONFLICT (id) DO NOTHING`,
      [
        `never-applied-${PROTOTYPE}`,
        PROTOTYPE,
        "NEVER APPLIED — planning prototype; skipped by scripts/bootstrap-fresh-db.mjs. `prisma migrate deploy` is unsafe on this repository.",
      ],
    );
  }

  // Prisma-compatible history for the migrations this script applied.
  if (!verifyOnly) {
    for (const migration of CHAIN) {
      const file = path.join(MIGRATIONS_DIR, migration, "migration.sql");
      if (!fs.existsSync(file)) continue;
      const checksum = sha256(fs.readFileSync(file));
      await client.query(
        `INSERT INTO "${schemaName}"._prisma_migrations (id, checksum, finished_at, migration_name, logs, applied_steps_count)
         VALUES ($1, $2, now(), $3, $4, 1)
         ON CONFLICT (id) DO NOTHING`,
        [migration, checksum, migration, "Applied by scripts/bootstrap-fresh-db.mjs (migration.sql + supplement.sql)."],
      );
    }
  }

  // --------------------------------------------------------------- grants
  // The runtime grant model REPLAYED FROM THE REFERENCE DATABASE (the live
  // `hyper_almoatasem` ACL for `hyper_app`), because the app's read/write
  // paths need the full surface. Two deliberate differences from the
  // reference ACL:
  //   * `_prisma_migrations` is NOT granted (the reference database grants it,
  //     which contradicts `scripts/staging-app-grants.sql` — the ledger stays
  //     migrator-owned here).
  //   * `bootstrap_ledger` is NOT granted (bootstrap metadata).
  // Everything else matches production exactly so a freshly bootstrapped
  // database behaves like the live one.
  //
  // `delivery_zones` and `guest_checkout_sessions` belong to the residual
  // migration (20261029). They were missing here, so a freshly bootstrapped
  // database had NO runtime access to the delivery-zone table — every
  // estimate/checkout/order-create answered 500 because the fee resolver could
  // not read its own zones. The completeness check below is what catches that
  // class of drift.
  const GRANT_FULL = [
    "admin_auth_rate_limits", "admin_auth_tokens", "admin_sessions", "audit_logs",
    "brands", "cart_items", "carts", "categories", "coupon_usages", "coupons",
    "customer_addresses", "customer_auth_rate_limits", "customer_sessions",
    "customers", "delivery_zones", "guest_checkout_sessions", "guest_order_credentials",
    "guest_order_rate_limits", "inventory",
    "inventory_movements", "notifications", "order_discounts",
    "order_item_replacements", "order_items", "order_status_history", "orders",
    "permissions", "product_codes", "product_images", "product_price_history",
    "product_variants", "products", "promotion_buy_get_rules", "promotion_rules",
    "promotion_targets", "promotions", "role_permissions", "roles",
    "store_settings", "user_roles", "users",
  ];
  const granted = [];
  if (!verifyOnly) {
    await client.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO hyper_app`);
    await client.query(`GRANT USAGE ON SCHEMA public TO hyper_app`);
    for (const t of GRANT_FULL) {
      const exists = await one("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind='r'", [schemaName, t]);
      if (exists.n === 0) continue;
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${schemaName}"."${t}" TO hyper_app`);
      granted.push(`ALL ON ${t}`);
    }
    // Sequences used as column defaults by the app role.
    const seqs = await q("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='S'", [schemaName]);
    for (const s of seqs) {
      if (s.relname === "bootstrap_ledger_id_seq") continue;
      await client.query(`GRANT USAGE, SELECT ON SEQUENCE "${schemaName}"."${s.relname}" TO hyper_app`).catch(() => {});
    }
    // Views are READ-ONLY for the runtime role. They were not granted at
    // all, so a freshly bootstrapped database could not read
    // `product_stock_status` — the raw-SQL view behind the storefront
    // inventory-availability endpoint — and that endpoint answered 500
    // ("permission denied for view product_stock_status"). The view is
    // derived from tables hyper_app already fully owns, so SELECT on it
    // widens nothing: it only makes the derived read reachable.
    const views = await q("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='v' ORDER BY c.relname", [schemaName]);
    for (const v of views) {
      await client.query(`GRANT SELECT ON "${schemaName}"."${v.relname}" TO hyper_app`);
      granted.push(`SELECT ON ${v.relname}`);
    }

    // Completeness check: EVERY application table must be readable and
    // writable by the runtime role, and EVERY view must be readable. A table
    // or view that exists but is not granted makes the app answer 500 on the
    // paths that touch it, and a freshly bootstrapped database must never be
    // that database. The two ledger tables are the only documented
    // exclusions.
    const ungranted = await q(`
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r','p')
         AND c.relname <> '_prisma_migrations'
         AND c.relname <> 'bootstrap_ledger'
         AND NOT has_table_privilege('hyper_app', c.oid, 'SELECT')
         AND NOT has_table_privilege('hyper_app', c.oid, 'INSERT,UPDATE,DELETE')
       ORDER BY 1
    `, [schemaName]);
    if (ungranted.length > 0) {
      await client.end();
      refuse(
        `the runtime role hyper_app has no access to ${ungranted.length} application table(s); add them to GRANT_FULL`,
        { tables: ungranted.map((r) => r.relname) },
      );
    }
    const unreadableViews = await q(`
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'v'
         AND NOT has_table_privilege('hyper_app', c.oid, 'SELECT')
       ORDER BY 1
    `, [schemaName]);
    if (unreadableViews.length > 0) {
      await client.end();
      refuse(
        `the runtime role hyper_app cannot read ${unreadableViews.length} view(s); grant SELECT on them`,
        { views: unreadableViews.map((r) => r.relname) },
      );
    }
    log(`GRANT_COMPLETENESS_OK app_tables=${appTables.length} app_views=${views.length}`);
  }

  // ------------------------------------------------------------ inventory
  const inventory = {
    tables: Number((await one(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' AND c.relname<>'_prisma_migrations'`, [schemaName])).n),
    views: Number((await one(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='v'`, [schemaName])).n),
    sequences: Number((await one(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='S'`, [schemaName])).n),
    indexes: Number((await one(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='i'`, [schemaName])).n),
    partial_indexes: Number((await one(`SELECT count(*)::int AS n FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND i.indpred IS NOT NULL`, [schemaName])).n),
    foreign_keys: Number((await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND connamespace=$1::regnamespace`, [schemaName])).n),
    check_constraints: Number((await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype='c' AND connamespace=$1::regnamespace`, [schemaName])).n),
    triggers: Number((await one(`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal`, [schemaName])).n),
    functions: Number((await one(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1`, [schemaName])).n),
    extensions: (await q("SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm') ORDER BY 1")).map((r) => r.extname),
    ledger_rows: Number((await one(`SELECT count(*)::int AS n FROM "${schemaName}".bootstrap_ledger`)).n),
    prisma_ledger_rows: Number((await one(`SELECT count(*)::int AS n FROM "${schemaName}"._prisma_migrations`)).n),
  };

  await client.end();

  const report = {
    tool: "bootstrap-fresh-db",
    identity: identityProof,
    collation,
    applied,
    skipped,
    failed,
    grants: granted.length,
    inventory,
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else log(JSON.stringify(report, null, 2));
  if (failed.length > 0) process.exitCode = 2;
};

main().catch((e) => {
  console.error(`FATAL: ${e?.message ?? e}`);
  process.exit(1);
});
