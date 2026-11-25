import "dotenv/config";
import fs from "node:fs";
import { Client } from "pg";

// Creates the scratch database ONLY. Safe-by-design:
// - Connects to the maintenance database `postgres`, never to hyper_almoatasem.
// - Never drops, truncates, or alters anything. If the scratch database already
//   exists and is non-empty, it aborts with a non-zero exit code.
// - The scratch database is created OWNED BY hyper_migrator so that all later
//   migration/SQL steps can run least-privilege as hyper_migrator.
// - Credentials: superuser password is read at runtime from the local
//   provisioning file and is never logged or printed.
const SUPERUSER_PW_FILE = "C:\\pgprov\\.superpw";
const DEFAULT_SCRATCH_DB = "hyper_almoatasem_scratch";
const SCRATCH_OWNER = "hyper_migrator";

// The scratch database MUST be created with a UTF-8-aware collation.
// pg_trgm extracts trigrams with the DATABASE's character classification:
// under a C/POSIX ctype every non-ASCII character is dropped, so an Arabic
// product name folds to an EMPTY trigram set and the catalog's typo (tier-1)
// and brand/category (tier-0) recall arms silently return nothing.
// Measured on PostgreSQL 18.4:
//   C collation                  -> similarity('بيسبي','بيبسي') = 0
//   ICU  LOCALE 'ar-EG'          -> 0.20  (exactly the SEARCH_MIN_SIMILARITY
//                                    the search tuning is calibrated against)
//   libc 'Arabic_Egypt.1252'     -> 0.20
// `LOCALE_PROVIDER icu ICU_LOCALE 'ar-EG'` alone is NOT sufficient:
// PostgreSQL silently falls back to the template's C collation in that form,
// so the locale is pinned through the LOCALE clause instead.
const LOCALE_CANDIDATES = [
  `LOCALE_PROVIDER icu LOCALE 'ar-EG'`,
  `LC_COLLATE 'Arabic_Egypt.1252' LC_CTYPE 'Arabic_Egypt.1252'`,
];

const isCCollation = (row) =>
  ["C", "POSIX"].includes(String(row?.datcollate)) ||
  ["C", "POSIX"].includes(String(row?.datctype));

// Optional: node scripts/create-scratch-db.mjs --db <name>
// Guarded: only explicitly allowlisted scratch databases (never production).
const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_closure_20261030",
  // Final-Closure run (2026-11-06): dedicated isolated E2E write-test DB
  // (never hyper_almoatasem; owned by hyper_migrator; emptied empty-bootstrap
  // target for scripts/bootstrap-fresh-db.mjs).
  "hyper_almoatasem_e2e_20261106",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
  "hyper_almoatasem_restore_verify_20260924",
  "hyper_almoatasem_restore_verify_2_20260924",
];
const dbFlag = process.argv.indexOf("--db");
const SCRATCH_DB = dbFlag === -1 ? DEFAULT_SCRATCH_DB : process.argv[dbFlag + 1];

if (!SCRATCH_DB || !ALLOWED_SCRATCH_DBS.includes(SCRATCH_DB)) {
  console.error(`REFUSED_NOT_A_SCRATCH_DATABASE: ${SCRATCH_DB}`);
  process.exit(1);
}

const sourceUrl = process.env.MIGRATION_DATABASE_URL;

if (!sourceUrl) {
  throw new Error("MIGRATION_DATABASE_URL is missing");
}

const superPw = fs.readFileSync(SUPERUSER_PW_FILE, "utf8").trim();
const adminUrl = new URL(sourceUrl);
adminUrl.username = "pghyper";
adminUrl.password = superPw;
adminUrl.pathname = "/postgres";

const client = new Client({
  connectionString: adminUrl.toString(),
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();

  const exists = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [SCRATCH_DB],
  );

  if (exists.rowCount === 0) {
    const attempts = [];
    let created = false;
    for (const loc of LOCALE_CANDIDATES) {
      try {
        await client.query(
          `CREATE DATABASE "${SCRATCH_DB}" OWNER "${SCRATCH_OWNER}" TEMPLATE template0 ${loc}`,
        );
      } catch (e) {
        attempts.push(`${loc} => ${e.code}: ${e.message}`);
        continue;
      }
      const meta = await client.query(
        "SELECT datcollate, datctype FROM pg_database WHERE datname = $1",
        [SCRATCH_DB],
      );
      if (isCCollation(meta.rows[0])) {
        attempts.push(`${loc} => created but the collation is C/POSIX; dropped`);
        await client.query(`DROP DATABASE "${SCRATCH_DB}"`);
        continue;
      }
      attempts.push(`${loc} => created (datcollate=${meta.rows[0].datcollate})`);
      created = true;
      break;
    }
    if (!created) {
      console.error("SCRATCH_DATABASE_LOCALE_UNAVAILABLE");
      console.error(JSON.stringify({ attempts }, null, 2));
      console.error(
        "The scratch database could not be created with a UTF-8-aware collation. " +
          "A C/POSIX collation makes Arabic pg_trgm similarity 0, so the catalog's " +
          "typo and brand/category recall silently return nothing. Fix the cluster's " +
          "locale support (PostgreSQL 15+ with ICU, or an Arabic libc locale) and re-run.",
      );
      process.exit(3);
    }
    console.log(`SCRATCH_DATABASE_CREATED ${SCRATCH_DB}`);
    console.log(`SCRATCH_DATABASE_LOCALE ${JSON.stringify(attempts[attempts.length - 1])}`);
  } else {
    console.log(`SCRATCH_DATABASE_ALREADY_EXISTS ${SCRATCH_DB}`);
    const scratchUrl = new URL(sourceUrl);
    scratchUrl.pathname = `/${SCRATCH_DB}`;
    const probe = new Client({
      connectionString: scratchUrl.toString(),
      connectionTimeoutMillis: 5000,
    });
    try {
      await probe.connect();
      const t = await probe.query(
        `SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      console.log(`SCRATCH_TABLE_COUNT ${t.rows[0].n}`);
      const c = await probe.query(
        `SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()`,
      );
      console.log(`SCRATCH_DATABASE_LOCALE ${JSON.stringify(c.rows[0])}`);
      if (isCCollation(c.rows[0])) {
        console.error(
          "SCRATCH_DATABASE_C_COLLATION: this database has a C/POSIX collation, so " +
            "Arabic pg_trgm similarity is 0 and the catalog's typo/brand recall is dead. " +
            "Drop and recreate it with a UTF-8-aware locale.",
        );
        process.exitCode = 4;
      }
      if (t.rows[0].n !== 0) {
        console.error("SCRATCH_DATABASE_NOT_EMPTY_ABORT");
        process.exitCode = 2;
      }
    } finally {
      await probe.end().catch(() => {});
    }
  }
} finally {
  await client.end().catch(() => {});
}
