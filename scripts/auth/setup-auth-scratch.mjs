// Auth scratch setup (scratch-only): seed bootstrap data, create a store-admin
// test identity, set both passwords via the bootstrap CLI. Never production.
// Usage: node scripts/auth/setup-auth-scratch.mjs --db <name>
// Prints ONLY non-secret progress lines (never passwords or URLs).
import { spawnSync } from "node:child_process";
import "dotenv/config";
import { Client } from "pg";

const dbName = process.argv[process.argv.indexOf("--db") + 1];
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
const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const STORE_EMAIL = "store-admin@example.com";

function runSeed() {
  const r = spawnSync("node", ["prisma/seed.mjs"], {
    cwd: "D:/Hyper_el-moatasem",
    env: { ...process.env, DATABASE_URL: scratchUrl, SEED_TARGET: "scratch" },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error("SEED_STEP_FAILED");
    console.error((r.stderr || "").split("\n").slice(0, 5).join("\n"));
    process.exit(1);
  }
  console.log("setup: seed OK");
}

function runBootstrap(email, password) {
  const r = spawnSync("node", ["scripts/bootstrap-admin-password.mjs", "--email", email], {
    cwd: "D:/Hyper_el-moatasem",
    env: { ...process.env, DATABASE_URL: scratchUrl },
    input: `${password}\n${password}\n`,
    encoding: "utf8",
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (r.status !== 0 || out.includes(password)) {
    console.error(`BOOTSTRAP_STEP_FAILED for ${email}`);
    process.exit(1);
  }
  console.log(`setup: bootstrap OK for ${email}`);
}

async function main() {
  runSeed();
  const c = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    await c.query("BEGIN");
    const storeRole = (await c.query(`SELECT id FROM roles WHERE name='STORE_ADMIN'`)).rows[0];
    await c.query(
      `INSERT INTO users (name, email, phone, is_active) VALUES ('Store Admin', $1, '201111111111', TRUE)
       ON CONFLICT (email) DO NOTHING`,
      [STORE_EMAIL],
    );
    const u = (await c.query(`SELECT id FROM users WHERE email=$1`, [STORE_EMAIL])).rows[0];
    await c.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [u.id, storeRole.id],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
  console.log("setup: store-admin identity OK");
  runBootstrap(OWNER_EMAIL, "Test-Owner-Pass-0001!");
  runBootstrap(STORE_EMAIL, "Test-Store-Pass-0002!");
  console.log(JSON.stringify({ setup: "OK", database: dbName }));
}
main().catch((e) => {
  console.error(`SETUP_FAILED: ${e.message}`);
  process.exit(1);
});
