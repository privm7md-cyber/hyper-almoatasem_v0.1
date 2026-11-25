// second-agent-run-prod.mjs — launcher that KEEPS the production-mode server as
// its child so the harness background shell stays alive with the server.
// Isolated: distDir .next-closure-verify, port 3223, e2e DB only.
import "dotenv/config";
import { spawn } from "node:child_process";

const base = new URL(process.env.MIGRATION_DATABASE_URL);
base.pathname = "/hyper_almoatasem_e2e_20261106";
const e2eUrl = base.toString();

const child = spawn(
  process.execPath,
  ["D:/Hyper_el-moatasem/node_modules/next/dist/bin/next", "start", "-p", "3223"],
  {
    cwd: "D:/Hyper_el-moatasem",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_DIST_DIR: ".next-closure-verify",
      DATABASE_URL: e2eUrl,
      MIGRATION_DATABASE_URL: e2eUrl,
      PORT: "3223",
      // Test harness IS the trusted proxy: it writes x-forwarded-for per
      // request so per-IP rate-limit buckets are exercised. Production
      // Vercel is unaffected (platform sets VERCEL=1 separately).
      // REG_RATE_LIMIT_PHONE_SECRET is REQUIRED by t-customer-register-ratelimit
      // (HMAC-bound phone-bucket digest evidence). Test-only value.
      TRUSTED_PROXY: "1",
      REG_RATE_LIMIT_PHONE_SECRET: "9f".repeat(32),
    },
    stdio: "inherit",
  },
);
child.on("exit", (code) => {
  console.log("PROD-SERVER-EXIT=" + code);
  process.exit(code ?? 0);
});