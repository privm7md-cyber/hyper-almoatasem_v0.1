// Token lifecycle tests (SQL-level, scratch-only): randomness, hash-only
// storage, expiry/used/purpose/user rejection, atomic single-winner race.
// The statements replicate the documented application contract
// (src/lib/auth/auth-tokens.ts): single UPDATE ... WHERE used_at IS NULL AND
// expires_at > now() ... RETURNING. Cleanup at the end (scratch-only).
import { randomBytes, createHash } from "node:crypto";
import "dotenv/config";
import { Client } from "pg";

const dbName = process.argv[process.argv.indexOf("--db") + 1];
if (dbName === "hyper_almoatasem" || !(dbName.endsWith("_20260923") || dbName.endsWith("_20260924"))) {
  console.error(`REFUSED: ${dbName}`);
  process.exit(1);
}
const url = new URL(process.env.MIGRATION_DATABASE_URL);
url.pathname = `/${dbName}`;
const c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 8000 });
const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass, detail });
const hex = (b) => createHash("sha256").update(b, "utf8").digest("hex");

try {
  await c.connect();
  // Dedicated token-test identity (parallel-safe): all test tokens belong to
  // this row; cleanup is scoped to it and can never touch other drivers' rows.
  const tokenUserEmail = `token-probe-${Date.now().toString(36)}@example.com`;
  await c.query(`INSERT INTO users (name, email, is_active) VALUES ('Token Probe', $1, TRUE)`, [tokenUserEmail]);
  const owner = (await c.query(`SELECT id FROM users WHERE email=$1`, [tokenUserEmail])).rows[0].id;
  const mk = async (purpose, ttlMin, userId = owner) => {
    const raw = randomBytes(32).toString("hex");
    const row = (await c.query(
      `INSERT INTO admin_auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval) RETURNING id`,
      [userId, purpose, hex(raw), String(ttlMin)],
    )).rows[0];
    return { raw, id: row.id };
  };
  const consume = async (raw, purpose, userId = null) =>
    (await c.query(
      `UPDATE admin_auth_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() AND ($3::uuid IS NULL OR user_id = $3::uuid) RETURNING id, user_id`,
      [hex(raw), purpose, userId],
    )).rows[0] || null;

  // 1. randomness: two tokens differ (plaintext and hash).
  const a = await mk("INVITATION", 60);
  const b = await mk("INVITATION", 60);
  t("random_tokens", a.raw !== b.raw, "");
  // 2. hash-only storage (no plaintext anywhere in the row).
  const stored = (await c.query(`SELECT token_hash FROM admin_auth_tokens WHERE id = $1`, [a.id])).rows[0];
  t("hash_only", stored.token_hash === hex(a.raw) && !stored.token_hash.includes(a.raw.slice(0, 8)), "");
  // 3. atomic consume success.
  const got = await consume(a.raw, "INVITATION");
  t("consume_success", !!got && got.id === a.id, "");
  // 4. used token rejected (replay).
  t("used_rejected", (await consume(a.raw, "INVITATION")) === null, "");
  // 5. expired token rejected (backdate created+expiry together so the
  // chk_tokens_expiry CHECK still holds; the token itself is long past).
  const e = await mk("PASSWORD_RESET", 60);
  await c.query(`UPDATE admin_auth_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1`, [e.id]);
  t("expired_rejected", (await consume(e.raw, "PASSWORD_RESET")) === null, "");
  // 6. wrong purpose rejected.
  const p = await mk("INVITATION", 60);
  t("wrong_purpose_rejected", (await consume(p.raw, "PASSWORD_RESET")) === null, "");
  // 7. wrong user rejected.
  const storeRow = (await c.query(`SELECT id FROM users WHERE email='store-admin@example.com'`)).rows[0];
  const store = storeRow ? storeRow.id : owner;
  const u = await mk("INVITATION", 60);
  t("wrong_user_rejected", (await consume(u.raw, "INVITATION", store)) === null, "");
  // 8. malformed token rejected.
  t("malformed_rejected", (await consume("not-a-token", "INVITATION")) === null, "");
  // 9. concurrent consume race: exactly one winner.
  const r = await mk("PASSWORD_RESET", 60);
  const outs = await Promise.all(Array.from({ length: 10 }, () => consume(r.raw, "PASSWORD_RESET")));
  t("consume_race_single_winner", outs.filter(Boolean).length === 1, `winners=${outs.filter(Boolean).length}`);
  // 10. token CHECKs hold (purpose domain enforced by DB).
  try {
    await c.query(`INSERT INTO admin_auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,'WRONG',$2, now() + interval '1 hour')`, [owner, hex(randomBytes(32).toString("hex"))]);
    t("purpose_check", false, "bad purpose accepted");
  } catch (err) {
    t("purpose_check", err?.code === "23514", `code=${err?.code}`);
  }
  // Cleanup test tokens AND probe identity, scoped to this run's user
  // (scratch-only; never touches other rows).
  await c.query(`DELETE FROM admin_auth_tokens WHERE user_id = $1`, [owner]);
  await c.query(`DELETE FROM user_roles WHERE user_id = $1`, [owner]);
  await c.query(`DELETE FROM users WHERE id = $1`, [owner]);
  const failures = results.filter((r) => !r.pass).length;
  console.log(JSON.stringify({ database: dbName, failures, results }, null, 2));
  process.exitCode = failures === 0 ? 0 : 2;
} finally {
  await c.end().catch(() => {});
}
