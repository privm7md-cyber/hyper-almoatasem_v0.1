import "dotenv/config";
import fs from "node:fs";
import { Client } from "pg";

// Applies a SQL file to a scratch database ONLY, as hyper_migrator.
// Hard guards (refuse to run if violated):
// - target database name MUST end with `_scratch` (production can never match).
// - target database must NOT be `hyper_almoatasem` (explicit block).
// - the SQL file must exist and be non-empty.
// Usage: node scripts/apply-sql-file.mjs --db <name> --file <path>
const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const fileFlag = args.indexOf("--file");

if (dbFlag === -1 || fileFlag === -1 || !args[dbFlag + 1] || !args[fileFlag + 1]) {
  console.error("USAGE: node scripts/apply-sql-file.mjs --db <name> --file <path>");
  process.exit(1);
}

const dbName = args[dbFlag + 1];
const filePath = args[fileFlag + 1];

// Guarded: only explicitly allowlisted scratch databases (never production).
const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

if (!ALLOWED_SCRATCH_DBS.includes(dbName)) {
  console.error(`REFUSED_NOT_A_SCRATCH_DATABASE: ${dbName}`);
  process.exit(1);
}

if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
  console.error(`REFUSED_MISSING_OR_EMPTY_SQL_FILE: ${filePath}`);
  process.exit(1);
}

const sourceUrl = process.env.MIGRATION_DATABASE_URL;

if (!sourceUrl) {
  throw new Error("MIGRATION_DATABASE_URL is missing");
}

const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${dbName}`;

const started = Date.now();
const client = new Client({
  connectionString: targetUrl.toString(),
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  const raw = fs.readFileSync(filePath);
  // PowerShell `>` redirection writes UTF-16LE (with BOM). Decode to text
  // without modifying the file on disk.
  const sql =
    raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe
      ? raw.subarray(2).toString("utf16le")
      : raw.toString("utf8");
  await client.query(sql);
  console.log(`APPLY_OK db=${dbName} file=${filePath} ms=${Date.now() - started}`);
} catch (error) {
  console.error(`APPLY_FAILED db=${dbName} file=${filePath}`);
  console.error(`code=${error?.code} message=${error?.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
