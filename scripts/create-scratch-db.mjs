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

// Optional: node scripts/create-scratch-db.mjs --db <name>
// Guarded: only explicitly allowlisted scratch databases (never production).
const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
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
    await client.query(
      `CREATE DATABASE "${SCRATCH_DB}" OWNER "${SCRATCH_OWNER}"`,
    );
    console.log(`SCRATCH_DATABASE_CREATED ${SCRATCH_DB}`);
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
