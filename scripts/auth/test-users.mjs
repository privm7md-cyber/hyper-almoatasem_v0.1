// Run-local test identities (parallel-safe): creates timestamped owner/store
// users on scratch, assigns roles, sets passwords via the bootstrap CLI.
// Nothing is ever printed that contains a password. Scratch-only guard.
// Usage (imported by runners): const creds = await createRunUsers(dbName)
import { spawnSync } from "node:child_process";
import "dotenv/config";
import { Client } from "pg";

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

export async function createRunUsers(dbName) {
  if (!ALLOWED.includes(dbName)) throw new Error(`REFUSED: ${dbName}`);
  const stamp = Date.now().toString(36);
  const rnd = () => Math.floor(Math.random() * 10);
  // Unique phones per run (partial-UQ on phone forbids reuse across runs).
  const owner = { email: `owner-${stamp}@example.com`, password: `T-${stamp}-Owner-Pass-0001!`, phone: `2011${String(Date.now()).slice(-6)}${rnd()}` };
  const store = { email: `store-${stamp}@example.com`, password: `T-${stamp}-Store-Pass-0002!`, phone: `2012${String(Date.now()).slice(-6)}${rnd()}` };
  const url = (() => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await c.connect();
  try {
    const superId = (await c.query(`SELECT id FROM roles WHERE name='SUPER_ADMIN'`)).rows[0].id;
    const storeId = (await c.query(`SELECT id FROM roles WHERE name='STORE_ADMIN'`)).rows[0].id;
    for (const [u, roleId] of [[owner, superId], [store, storeId]]) {
      await c.query(
        `INSERT INTO users (name, email, phone, is_active) VALUES ('Run User', $1, $2, TRUE)`,
        [u.email, u.phone],
      );
      const row = (await c.query(`SELECT id FROM users WHERE email=$1`, [u.email])).rows[0];
      await c.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [row.id, roleId]);
    }
  } finally {
    await c.end().catch(() => {});
  }
  for (const u of [owner, store]) {
    const r = spawnSync("node", ["scripts/bootstrap-admin-password.mjs", "--email", u.email], {
      cwd: "D:/Hyper_el-moatasem",
      env: { ...process.env, DATABASE_URL: url },
      input: `${u.password}\n${u.password}\n`,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`bootstrap failed for ${u.email}: ${(r.stdout || "") + (r.stderr || "")}`.slice(0, 300));
  }
  return { owner, store };
}
