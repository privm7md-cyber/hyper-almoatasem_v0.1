// second-agent-start-prod.mjs — starts an ISOLATED production-mode Next server for
// measurement. Separate dist dir, separate port, isolated e2e DB only.
// Usage: node scripts/second-agent-start-prod.mjs   (detached; writes PID file)
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = "D:/Hyper_el-moatasem";
const OUT = "D:/Hyper_Data_Review/Second_Agent_Completion/Run_20261106_210603";
const PORT = "3223";
const base = new URL(process.env.MIGRATION_DATABASE_URL);
base.pathname = "/hyper_almoatasem_e2e_20261106";
const e2eUrl = base.toString();

fs.mkdirSync(path.join(OUT, "Logs"), { recursive: true });
const logPath = path.join(OUT, "Logs", "prod-server.log");
const log = fs.createWriteStream(logPath, { flags: "a" });
const nextBin = path.join(REPO, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", PORT], {
  cwd: REPO,
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_DIST_DIR: ".next-closure-verify",
    DATABASE_URL: e2eUrl,
    MIGRATION_DATABASE_URL: e2eUrl,
    PORT,
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
child.stdout.on("data", (d) => log.write(d));
child.stderr.on("data", (d) => log.write(d));
child.on("exit", (code) => fs.appendFileSync(logPath, `\nPROD-SERVER-EXIT=${code}\n`));
child.unref();
fs.writeFileSync(path.join(OUT, "Logs", "prod-server.pid"), String(child.pid));
console.log("PROD-SERVER-STARTED pid=" + child.pid + " port=" + PORT);
