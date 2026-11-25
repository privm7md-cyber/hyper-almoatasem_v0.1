// second-agent-e2e-admin-users.mjs — creates the two fixed admin test identities
// the API suites expect (store-cat / bare-cat) on the isolated e2e DB, idempotently.
// Mirrors scripts/auth/test-users.mjs conventions (users + user_roles rows).
import "dotenv/config";
import { Client } from "pg";

const base = new URL(process.env.MIGRATION_DATABASE_URL);
base.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: base.toString() });
await c.connect();

const storeRole = (await c.query(`SELECT id FROM roles WHERE name='STORE_ADMIN'`)).rows[0]?.id;
if (!storeRole) throw new Error("STORE_ADMIN role missing");

const users = [
  { name: "Store Cat", email: "store-cat-test@example.com", phone: "201099900001", roleId: storeRole },
  { name: "Bare Cat", email: "bare-cat-test@example.com", phone: "201099900002", roleId: null },
];
for (const u of users) {
  const existing = (await c.query(`SELECT id FROM users WHERE email=$1`, [u.email])).rows[0];
  if (existing) {
    console.log("EXISTS " + u.email);
    continue;
  }
  await c.query(
    `INSERT INTO users (name, email, phone, is_active) VALUES ($1,$2,$3,TRUE)`,
    [u.name, u.email, u.phone],
  );
  const row = (await c.query(`SELECT id FROM users WHERE email=$1`, [u.email])).rows[0];
  if (u.roleId) {
    await c.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [row.id, u.roleId]);
  }
  console.log("CREATED " + u.email);
}
await c.end();