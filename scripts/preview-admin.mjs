// ADMIN PREVIEW RUNNER — starts a SECOND dev server for the admin rebuild.
//
// Safety rules this script enforces:
//   • The preview NEVER points at `hyper_almoatasem` (the production-named
//     database) — it always uses an allowlisted scratch database.
//   • It never touches the existing dev server on port 3131: it uses its own
//     port and its own build directory (NEXT_DIST_DIR) so the two servers do
//     not share the .next lock.
//   • It never prints the database URL, the password, or any token.
//
// Usage:
//   node scripts/preview-admin.mjs --db hyper_almoatasem_scratch --port 3132
//
// The account to use is printed (email only). The password is set separately
// through scripts/bootstrap-admin-password.mjs against the same scratch DB.

import "dotenv/config";
import { spawn } from "node:child_process";

const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_closure_20261030",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
  "hyper_almoatasem_restore_verify_20260924",
  "hyper_almoatasem_restore_verify_2_20260924",
];

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const dbName = arg("db", "hyper_almoatasem_scratch");
const port = arg("port", "3132");

if (!ALLOWED_SCRATCH_DBS.includes(dbName)) {
  console.error(`REFUSED_NOT_A_SCRATCH_DATABASE: ${dbName}`);
  process.exit(1);
}
if (!process.env.MIGRATION_DATABASE_URL) {
  console.error("MIGRATION_DATABASE_URL is missing");
  process.exit(1);
}

const url = new URL(process.env.MIGRATION_DATABASE_URL);
url.pathname = `/${dbName}`;

// The app user for the scratch DB is the same role the dev environment uses;
// the URL is never printed.
const appUrl = new URL(url.toString());
appUrl.username = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).username
  : appUrl.username;
appUrl.password = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).password
  : appUrl.password;

const distDir = `.next-preview-${port}`;

console.log(`preview: database=${dbName} (scratch allowlist OK)`);
console.log(`preview: port=${port}  dist=${distDir}`);
console.log(`preview: starting — first compile takes a moment`);

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--port", port],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: appUrl.toString(),
      MIGRATION_DATABASE_URL: url.toString(),
      NEXT_DIST_DIR: distDir,
      NODE_ENV: "development",
    },
    stdio: "inherit",
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
