// Self-test for the fail-closed disposable database guard. No writes, no DB required.
import {
  DatabaseGuardError,
  PRIMARY_DATABASE,
  SCRATCH_DATABASE,
  DISPOSABLE_DATABASE,
  DISPOSABLE_PORT,
  assertDisposableDatabaseUrl,
  assertDisposableEnvironment,
  assertPrimaryCleanupConfirmation,
} from "./lib/disposable-db-guard.mjs";

const results = [];
function expectReject(name, fn, pattern) {
  try {
    fn();
    results.push({ name, pass: false, error: "expected rejection, got success" });
    console.log(`FAIL ${name}: expected rejection`);
  } catch (e) {
    const pass = e instanceof DatabaseGuardError && (!pattern || pattern.test(e.message));
    results.push({ name, pass, error: pass ? null : e.message });
    console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: ${e.message}`}`);
  }
}
function expectAccept(name, fn) {
  try {
    const value = fn();
    results.push({ name, pass: true, value });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

const disposableUrl = `postgresql://hyper_app:secret@127.0.0.1:${DISPOSABLE_PORT}/${DISPOSABLE_DATABASE}`;
const primaryUrl = `postgresql://hyper_app:secret@127.0.0.1:5432/${PRIMARY_DATABASE}`;
const scratchUrl = `postgresql://hyper_app:secret@127.0.0.1:5432/${SCRATCH_DATABASE}`;

expectReject("Primary URL denied", () => assertDisposableDatabaseUrl(primaryUrl, { context: "selftest" }), /Primary database/);
expectReject("Scratch URL denied", () => assertDisposableDatabaseUrl(scratchUrl, { context: "selftest" }), /Scratch database/);
expectReject("Unknown local database denied", () => assertDisposableDatabaseUrl("postgresql://a:b@127.0.0.1:55449/other_db", { context: "selftest" }), /only "hyper_v1_ops_disposable"/);
expectReject("Disposable name on wrong port denied", () => assertDisposableDatabaseUrl(`postgresql://a:b@127.0.0.1:5432/${DISPOSABLE_DATABASE}`, { context: "selftest" }), /only "hyper_v1_ops_disposable"/);
expectReject("Remote host denied", () => assertDisposableDatabaseUrl(`postgresql://a:b@db.example.com:${DISPOSABLE_PORT}/${DISPOSABLE_DATABASE}`, { context: "selftest" }), /not a local disposable host/);
expectReject("Missing URL denied", () => assertDisposableDatabaseUrl("", { context: "selftest" }), /no database URL/);
expectReject("Malformed URL denied", () => assertDisposableDatabaseUrl("not-a-url", { context: "selftest" }), /not valid/);
expectAccept("Exact disposable URL accepted", () => assertDisposableDatabaseUrl(disposableUrl, { context: "selftest" }));

const original = { DATABASE_URL: process.env.DATABASE_URL, V1_OPS_DATABASE_URL: process.env.V1_OPS_DATABASE_URL };
try {
  process.env.DATABASE_URL = disposableUrl;
  process.env.V1_OPS_DATABASE_URL = disposableUrl;
  expectAccept("Both env URLs disposable accepted", () => assertDisposableEnvironment({ context: "selftest", requireKeys: ["DATABASE_URL", "V1_OPS_DATABASE_URL"] }));

  process.env.V1_OPS_DATABASE_URL = primaryUrl;
  expectReject("Split env with Primary denied", () => assertDisposableEnvironment({ context: "selftest", requireKeys: ["DATABASE_URL"] }), /V1_OPS_DATABASE_URL.*Primary database/);

  delete process.env.V1_OPS_DATABASE_URL;
  process.env.DATABASE_URL = primaryUrl;
  expectReject("Direct .env Primary denied", () => assertDisposableEnvironment({ context: "selftest", requireKeys: ["DATABASE_URL"] }), /DATABASE_URL.*Primary database/);

  delete process.env.DATABASE_URL;
  expectReject("No env URL denied", () => assertDisposableEnvironment({ context: "selftest", requireKeys: ["DATABASE_URL"] }), /DATABASE_URL is required/);
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

expectReject("Primary cleanup without confirmation denied", () => assertPrimaryCleanupConfirmation(null, { context: "selftest" }), /confirm-primary/);
expectAccept("Primary cleanup with exact confirmation accepted", () => assertPrimaryCleanupConfirmation(PRIMARY_DATABASE, { context: "selftest" }));

const failed = results.filter((r) => !r.pass);
const payload = { total: results.length, failed: failed.length, results };
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(payload, null, 2));
console.log(`SUMMARY total=${results.length} failed=${failed.length}`);
process.exitCode = failed.length ? 1 : 0;
