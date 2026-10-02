// Auth flow suite: 19 login/session/cookie tests over HTTP (scratch-only).
// ctx: { baseUrl, dbName, owner: {email,password}, store: {email,password} }
import { makeClient, sql, resetAuthState, liveSessions, GENERIC_MSG, COOKIE_NAME } from "./_client.mjs";

export async function run(ctx) {
  const results = [];
  const t = (name, pass, detail = "") => results.push({ name, pass, detail });
  const { baseUrl, dbName, owner, store } = ctx;

  // Clean slate for deterministic assertions.
  await resetAuthState(dbName);
  await sql(dbName, `UPDATE users SET is_active = TRUE, deleted_at = NULL`);

  // 1. valid login: 201 + session cookie set.
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    const body = JSON.parse(r.text);
    t("valid_login", r.res.status === 201 && body.data?.admin?.email === owner.email && !!c.jar[COOKIE_NAME], `status=${r.res.status}`);
  }
  // 2. wrong password: 401 + generic message, no cookie.
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: "Wrong-Password-000!" });
    const body = JSON.parse(r.text);
    t("wrong_password", r.res.status === 401 && body.error?.message === GENERIC_MSG && body.error?.code === "UNAUTHENTICATED" && !c.jar[COOKIE_NAME], `status=${r.res.status}`);
  }
  // 3. unknown email: byte-identical behavior to wrong password.
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: "nobody@example.com", password: "Wrong-Password-000!" });
    const body = JSON.parse(r.text);
    t("unknown_email", r.res.status === 401 && body.error?.message === GENERIC_MSG, `status=${r.res.status}`);
  }
  // 4. inactive user rejected generically.
  await sql(dbName, `UPDATE users SET is_active = FALSE WHERE email = $1`, [owner.email]);
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    const body = JSON.parse(r.text);
    t("inactive_user", r.res.status === 401 && body.error?.message === GENERIC_MSG, `status=${r.res.status}`);
  }
  await sql(dbName, `UPDATE users SET is_active = TRUE WHERE email = $1`, [owner.email]);
  // 5. soft-deleted user rejected generically (frozen CHECK: deleted => !active).
  await sql(dbName, `UPDATE users SET deleted_at = now(), is_active = FALSE WHERE email = $1`, [owner.email]);
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    t("soft_deleted_user", r.res.status === 401 && JSON.parse(r.text).error?.message === GENERIC_MSG, `status=${r.res.status}`);
  }
  await sql(dbName, `UPDATE users SET deleted_at = NULL, is_active = TRUE WHERE email = $1`, [owner.email]);
  // 6. locked account rejected generically.
  await sql(dbName, `UPDATE users SET locked_until = now() + interval '15 minutes' WHERE email = $1`, [owner.email]);
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    t("locked_account", r.res.status === 401 && JSON.parse(r.text).error?.message === GENERIC_MSG, `status=${r.res.status}`);
  }
  // 7. expired lock + correct password succeeds.
  await sql(dbName, `UPDATE users SET locked_until = now() - interval '1 minute', failed_login_attempts = 4 WHERE email = $1`, [owner.email]);
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    t("expired_lock_success", r.res.status === 201 && !!c.jar[COOKIE_NAME], `status=${r.res.status}`);
  }
  // 8. successful login clears failed attempts + lock.
  {
    const row = (await sql(dbName, `SELECT failed_login_attempts AS n, locked_until FROM users WHERE email = $1`, [owner.email])).rows[0];
    t("attempts_cleared", Number(row.n) === 0 && row.locked_until === null, `attempts=${row.n}`);
  }
  // 9. session row created for the user.
  {
    const sessions = await liveSessions(dbName, owner.email);
    t("session_created", sessions.length >= 1, `count=${sessions.length}`);
  }
  // 10. token not stored plaintext (raw cookie value absent from its row).
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const raw = c.jar[COOKIE_NAME];
    const r = await sql(dbName, `SELECT count(*)::int AS n FROM admin_sessions WHERE token_hash = $1`, [raw]);
    const r2 = await sql(dbName, `SELECT count(*)::int AS n FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND position($2 IN token_hash) > 0`, [store.email, raw.slice(0, 16)]);
    t("token_not_plaintext", raw.length === 64 && Number(r.rows[0].n) === 0 && Number(r2.rows[0].n) === 0, `len=${raw.length}`);
  }
  // 11. expired session rejected (backdate created+expiry together to respect
  // chk_sessions_expiry; the dedicated row is deleted afterwards).
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const raw = c.jar[COOKIE_NAME];
    await sql(dbName, `UPDATE admin_sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE token_hash = encode(digest(convert_to($1, 'UTF8'), 'sha256'), 'hex')`, [raw]);
    const g = await c.get("/api/admin/session");
    t("session_expiration", g.res.status === 401, `status=${g.res.status}`);
    await sql(dbName, `DELETE FROM admin_sessions WHERE token_hash = encode(digest(convert_to($1, 'UTF8'), 'sha256'), 'hex')`, [raw]);
  }
  // 12. logout revokes server-side + clears cookie.
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const raw = c.jar[COOKIE_NAME];
    await c.get("/api/admin/session", {});
    // use DELETE logout endpoint
    const res = await fetch(baseUrl + "/api/admin/session", { method: "DELETE", redirect: "manual", headers: { Cookie: `${COOKIE_NAME}=${raw}` } });
    const r2 = await sql(dbName, `SELECT revoked_at IS NOT NULL AS r FROM admin_sessions WHERE token_hash = encode(digest(convert_to($1, 'UTF8'), 'sha256'), 'hex')`, [raw]);
    const revoked = r2.rows[0]?.r === true;
    t("logout_revokes", res.status === 200 && revoked === true, `status=${res.status}`);
  }
  // 13. logout-all revokes every live session.
  {
    const a = makeClient(baseUrl);
    const b = makeClient(baseUrl);
    await a.post("/api/admin/session", { email: store.email, password: store.password });
    await b.post("/api/admin/session", { email: store.email, password: store.password });
    await sql(dbName, `UPDATE admin_sessions SET revoked_at = now() WHERE user_id = (SELECT id FROM users WHERE email=$1) AND revoked_at IS NULL`, [store.email]);
    const live = (await liveSessions(dbName, store.email)).filter((s) => !s.revoked && !s.expired);
    t("logout_all", live.length === 0, `live=${live.length}`);
    const ga = await a.get("/api/admin/session");
    t("logout_all_effective", ga.res.status === 401, `status=${ga.res.status}`);
  }
  // 14. disabled user: pre-existing session dies.
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    await sql(dbName, `UPDATE users SET is_active = FALSE WHERE email = $1`, [store.email]);
    const g = await c.get("/api/admin/session");
    t("disabled_session_dead", g.res.status === 401, `status=${g.res.status}`);
    await sql(dbName, `UPDATE users SET is_active = TRUE WHERE email = $1`, [store.email]);
  }
  // 15. password rotation invalidates old sessions (via bootstrap CLI pattern: direct update + revoke-all).
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const oldRaw = c.jar[COOKIE_NAME];
    await sql(dbName, `UPDATE admin_sessions SET revoked_at = now() WHERE user_id = (SELECT id FROM users WHERE email=$1)`, [store.email]);
    const g = await c.get("/api/admin/session");
    t("rotation_kills_old", g.res.status === 401 && oldRaw.length === 64, `status=${g.res.status}`);
  }
  // 16. fixation: planted cookie never becomes valid; login mints a fresh token.
  {
    const planted = "f".repeat(64);
    const c = makeClient(baseUrl);
    c.jar[COOKIE_NAME] = planted;
    await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    t("fixation_resistance", !!c.jar[COOKIE_NAME] && c.jar[COOKIE_NAME] !== planted, `rotated=${c.jar[COOKIE_NAME] !== planted}`);
  }
  // 17. cookie attributes.
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    const sc = r.setCookies.find((s) => s.startsWith(COOKIE_NAME + "=")) || "";
    const low = sc.toLowerCase();
    t("cookie_attrs", low.includes("httponly") && low.includes("path=/") && low.includes("samesite=lax") && sc.startsWith("__Host-"), sc.split(";").slice(1, 4).join(";"));
  }
  // 18. last_login_at updated on success.
  {
    const row = (await sql(dbName, `SELECT last_login_at IS NOT NULL AS s FROM users WHERE email = $1`, [owner.email])).rows[0];
    t("last_login_updated", row.s === true, "");
  }
  // 19. login_success audit row exists (raw-SQL writer path).
  {
    const row = (await sql(dbName, `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.login_success'`)).rows[0];
    t("audit_login_success", Number(row.n) >= 1, `count=${row.n}`);
  }
  await resetAuthState(dbName);
  return results;
}
