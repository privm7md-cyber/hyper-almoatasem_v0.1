// Evidence runner: executes one command and prints its output verbatim.
//
// Used by the ADM run folder to record a check (tests, type check) as
// stdout/stderr/exit evidence without any database or network access.
// Usage: node scripts/run-suite-evidence.mjs <command> [args...]
import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Provide a command to run.");
  process.exit(2);
}

const isWindows = process.platform === "win32";
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: 900000,
  shell: isWindows,
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.status ?? 1;
