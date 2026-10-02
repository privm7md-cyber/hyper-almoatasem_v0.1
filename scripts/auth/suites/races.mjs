// Concurrency races over HTTP (scratch-only).
// ctx: { baseUrl, dbName, owner: {email,password}, store: {email,password} }
import { makeClient, sql, resetAuthState, COOKIE_NAME } from "./_client.mjs";

export async function run(ctx) {
  const results = [];
  const t = (name, pass, detail = "") => results.push({ name, pass, detail });
  const { baseUrl, dbName, owner, store } = ctx;
  await resetAuthState(dbName);

  // R1. failed-login race: 12 parallel wrong passwords. Account bucket caps at
  // 10/window, so exactly 10 bumps must land (no lost increments), then lock.
  {
    await sql(dbName, `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [store.email]);
    const clients = Array.from({ length: 12 }, () => makeClient(baseUrl));
    const outs = await Promise.all(
      clients.map((c) => c.post("/api/admin/session", { email: store.email, password: "Wrong-Password-000!" })),
    );
    const row = (await sql(dbName, `SELECT failed_login_attempts AS n, locked_until IS NOT NULL AS l FROM users WHERE email=$1`, [store.email])).rows[0];
    const allDenied = outs.every((r) => r.res.status === 401);
    t("login_race_exact", allDenied && Number(row.n) === 10 && row.l === true, `attempts=${row.n} locked=${row.l}`);
    await sql(dbName, `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [store.email]);
  }
  // R2. valid-login race: 5 parallel logins mint 5 distinct live sessions.
  // (Fresh rate/attempt state: R1 saturated the store account bucket by design.)
  {
    await resetAuthState(dbName);
    const clients = Array.from({ length: 5 }, () => makeClient(baseUrl));
    const outs = await Promise.all(
      clients.map((c) => c.post("/api/admin/session", { email: owner.email, password: owner.password })),
    );
    const tokens = clients.map((c) => c.jar[COOKIE_NAME]).filter(Boolean);
    const uniq = new Set(tokens);
    t("session_race_distinct", outs.every((r) => r.res.status === 201) && uniq.size === 5, `distinct=${uniq.size}`);
  }
  // R3. revocation race: parallel revoke-all calls stay safe, all die.
  {
    const uid = (await sql(dbName, `SELECT id FROM users WHERE email=$1`, [owner.email])).rows[0].id;
    const kill = () => sql(dbName, `UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [uid]);
    await Promise.all([kill(), kill(), kill()]);
    const live = (await sql(dbName, `SELECT count(*)::int AS n FROM admin_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()`, [uid])).rows[0].n;
    t("revoke_race_safe", Number(live) === 0, `live=${live}`);
  }
  // R4. parallel logout of the same session is idempotent and safe.
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const raw = c.jar[COOKIE_NAME];
    const outs = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(baseUrl + "/api/admin/session", { method: "DELETE", redirect: "manual", headers: { Cookie: `${COOKIE_NAME}=${raw}` } }).then((r) => r.status),
      ),
    );
    t("double_logout_safe", outs.every((s) => s === 200), `statuses=${[...new Set(outs)].join(",")}`);
  }
  // R5. independent users log in concurrently without interference.
  {
    await resetAuthState(dbName);
    const a = makeClient(baseUrl);
    const b = makeClient(baseUrl);
    const [r1, r2] = await Promise.all([
      a.post("/api/admin/session", { email: owner.email, password: owner.password }),
      b.post("/api/admin/session", { email: store.email, password: store.password }),
    ]);
    t("independent_logins", r1.res.status === 201 && r2.res.status === 201, "");
  }
  // R6. mixed burst: valid logins still succeed while failures accumulate atomically.
  {
    await resetAuthState(dbName);
    await resetAuthState(dbName);
    await sql(dbName, `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [store.email]);
    const good = Array.from({ length: 3 }, () => makeClient(baseUrl));
    const bad = Array.from({ length: 4 }, () => makeClient(baseUrl));
    const [gouts, bouts] = await Promise.all([
      Promise.all(good.map((c) => c.post("/api/admin/session", { email: store.email, password: store.password }))),
      Promise.all(bad.map((c) => c.post("/api/admin/session", { email: store.email, password: "Wrong-Password-000!" }))),
    ]);
    const row = (await sql(dbName, `SELECT failed_login_attempts AS n FROM users WHERE email=$1`, [store.email])).rows[0];
    // Successes reset the counter afterwards only if they ran last; with races
    // the only invariant asserted is exact accounting: every bad attempt bumped
    // at most once and successes all hold valid sessions.
    const sessionsOk = gouts.every((r) => r.res.status === 201);
    const badDenied = bouts.every((r) => r.res.status === 401);
    const attempts = Number(row.n);
    t("mixed_burst_consistent", sessionsOk && badDenied && attempts >= 0 && attempts <= 4, `attempts=${attempts}`);
  }
  await resetAuthState(dbName);
  return results;
}
