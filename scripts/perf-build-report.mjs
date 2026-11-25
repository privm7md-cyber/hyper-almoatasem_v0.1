// PERFORMANCE BASELINE — builds a given source tree and records the route
// chunk sizes Next.js reports.
//
// Two modes:
//   --tree <dir>   build that directory (used for the "before" baseline: a
//                  read-only `git archive HEAD` export)
//   --current      build the working tree (the "after" measurement)
//
// Credentials never appear on a command line: the connection strings are read
// from the repo's own env files and overridden in-process, and the builder
// only ever prints sizes.
//
// Usage: node scripts/perf-build-report.mjs --tree /tmp/hyper-baseline --label before

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const label = arg("label", "current");
const treeArg = arg("tree", null);
const tree = treeArg ? resolve(treeArg) : ROOT;
const outDir = join(ROOT, "docs", "data-sources", "perf");
mkdirSync(outDir, { recursive: true });

// --- env assembly (never printed) -----------------------------------------
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

const baseEnv = {
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
  ...process.env,
};

// The scratch database is the only data source a build may touch. The
// production-named database is refused here as well.
const SCRATCH = "hyper_almoatasem_scratch";
if (!baseEnv.MIGRATION_DATABASE_URL) {
  console.error("MIGRATION_DATABASE_URL is missing");
  process.exit(1);
}
const scratchUrl = new URL(baseEnv.MIGRATION_DATABASE_URL);
scratchUrl.pathname = `/${SCRATCH}`;
if (scratchUrl.pathname === "/hyper_almoatasem") {
  console.error("REFUSED: refusing the production-named database");
  process.exit(1);
}

const appUrl = new URL(baseEnv.DATABASE_URL || baseEnv.MIGRATION_DATABASE_URL);
appUrl.pathname = `/${SCRATCH}`;

const env = {
  ...baseEnv,
  DATABASE_URL: appUrl.toString(),
  MIGRATION_DATABASE_URL: scratchUrl.toString(),
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_DIST_DIR: tree === ROOT ? ".next-perf" : ".next",
};

// --- build -----------------------------------------------------------------
console.log(`[${label}] building ${tree} ...`);
const started = Date.now();
const result = spawnSync(
  process.execPath,
  [join(ROOT, "node_modules/next/dist/bin/next"), "build"],
  { cwd: tree, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status !== 0) {
  console.error(`[${label}] build FAILED (exit ${result.status})`);
  console.error(output.split("\n").slice(-40).join("\n"));
  process.exit(1);
}

// --- parse the route table -------------------------------------------------
// Next 16 (Turbopack) prints the route table WITHOUT the per-route size
// columns the old webpack build printed. The sizes are read from the build
// artefacts instead — see perf-route-cost.mjs.
const ROUTE_RE = /^[├└]\s+([ƒ○●])\s+(\S+)\s*(.*)$/gm;
const routes = [];
for (const m of output.matchAll(ROUTE_RE)) {
  routes.push({
    route: m[2],
    kind: m[1] === "○" ? "static" : "dynamic",
    size: null,
    firstLoad: null,
    extra: m[3] ? m[3].trim() : "",
  });
}

const report = { label, tree, builtAtSeconds: elapsed, routes };
writeFileSync(join(outDir, `build-${label}.json`), JSON.stringify(report, null, 2), "utf8");
writeFileSync(join(outDir, `build-${label}.txt`), output, "utf8");

console.log(`\n[${label}] build OK in ${elapsed}s — ${routes.length} routes`);
const adminRoutes = routes.filter((r) => r.route.startsWith("/admin"));
for (const r of adminRoutes) {
  console.log(`  ${r.route.padEnd(42)} ${r.kind}`);
}
console.log(
  `\n  Next 16 prints no per-route sizes — read them from the artefacts with:` +
    `\n  node scripts/perf-route-cost.mjs <dist> ${label}`,
);
console.log(`\nreport written: docs/data-sources/perf/build-${label}.json`);
