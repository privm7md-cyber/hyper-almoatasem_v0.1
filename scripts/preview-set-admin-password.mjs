// PREVIEW ADMIN PASSWORD — sets a fresh owner password on an allowlisted
// scratch database for the local preview.
//
// Safety design:
//   - The target database is an allowlisted scratch database; the
//     production-named database is refused before any connection is opened.
//   - The password is GENERATED here, never typed on a command line, and
//     never printed to the terminal.
//   - It is written to a file OUTSIDE the repository, so it never lands in
//     the working tree or in a commit.
//   - The credential is piped into scripts/bootstrap-admin-password.mjs as
//     two lines (password + confirmation), which is that script's documented
//     non-TTY mode.
//
// Usage: node scripts/preview-set-admin-password.mjs [--db <name>] [--out <file>]

import "dotenv/config";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
const outFile = resolve(arg("out", "C:/Users/MEGA/.qoder/preview-admin-credentials.txt"));
const email = arg("email", "owner@hyper-al-moatasem.local");

if (!ALLOWED_SCRATCH_DBS.includes(dbName)) {
  console.error(`REFUSED_NOT_A_SCRATCH_DATABASE: ${dbName}`);
  process.exit(1);
}
if (!process.env.MIGRATION_DATABASE_URL) {
  console.error("MIGRATION_DATABASE_URL is missing");
  process.exit(1);
}

// A readable random password: letters and digits only, 20 characters.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let password = "";
for (let i = 0; i < 20; i += 1) password += ALPHABET[randomInt(ALPHABET.length)];

const url = new URL(process.env.MIGRATION_DATABASE_URL);
url.pathname = `/${dbName}`;
if (process.env.DATABASE_URL) {
  const app = new URL(process.env.DATABASE_URL);
  url.username = app.username;
  url.password = app.password;
}

const child = spawn(process.execPath, ["scripts/bootstrap-admin-password.mjs", "--email", email], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: url.toString() },
  stdio: ["pipe", "inherit", "inherit"],
});

child.stdin.write(`${password}\n${password}\n`);
child.stdin.end();

child.on("exit", (code) => {
  if (code === 0) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(
      outFile,
      `admin preview credentials\ndatabase: ${dbName}\nemail: ${email}\npassword: ${password}\n`,
      "utf8",
    );
    console.log(`password written to: ${outFile}`);
  } else {
    console.error("password was NOT changed — no credentials file was written");
  }
  process.exit(code ?? 0);
});
