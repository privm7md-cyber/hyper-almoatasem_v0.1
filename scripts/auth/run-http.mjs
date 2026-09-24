// HTTP runner: starts `next start` on scratch, runs suites, tears down.
// Usage: node scripts/auth/run-http.mjs --db <name> --port <port>
// Prints a JSON summary (never passwords). Scratch-only guard enforced.
import { spawn } from "node:child_process";
import "dotenv/config";

const dbFlag = process.argv.indexOf("--db");
const portFlag = process.argv.indexOf("--port");
const dbName = dbFlag === -1 ? "" : process.argv[dbFlag + 1];
const port = portFlag === -1 ? "3111" : process.argv[portFlag + 1];
const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];
if (!ALLOWED.includes(dbName)) {
  console.error(`REFUSED: ${dbName}`);
  process.exit(1);
}
const scratchUrl = (() => {
  const u = new URL(process.env.MIGRATION_DATABASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const serverLogs = [];
const server = spawn("npx", ["next", "start", "-p", String(port)], {
  cwd: "D:/Hyper_el-moatasem",
  env: { ...process.env, DATABASE_URL: scratchUrl, NEXT_TELEMETRY_DISABLED: "1", PORT: String(port) },
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => serverLogs.push(String(d)));
server.stderr.on("data", (d) => serverLogs.push(String(d)));

async function waitReady() {
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/admin/login`);
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("server did not become ready");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let suites = { suites: {}, failures: 0, total: 0 };
try {
  await waitReady();
  // Run-local identities: parallel-safe (no shared owner/store rows).
  const { createRunUsers } = await import("./test-users.mjs");
  const creds = await createRunUsers(dbName);
  const ctx = {
    baseUrl: `http://127.0.0.1:${port}`,
    dbName,
    owner: creds.owner,
    store: creds.store,
  };
  for (const name of ["auth-flow", "rbac", "races", "security"]) {
    const mod = await import(`./suites/${name}.mjs`);
    const results = await mod.run(ctx, serverLogs);
    const failures = results.filter((r) => !r.pass);
    suites.suites[name] = { total: results.length, failures: failures.length, failed: failures.map((f) => f.name) };
    suites.total += results.length;
    suites.failures += failures.length;
  }
  console.log(JSON.stringify(suites, null, 2));
  process.exitCode = suites.failures === 0 ? 0 : 2;
} finally {
  server.kill();
}
