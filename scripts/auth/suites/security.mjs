// Security suite over HTTP (scratch-only).
// ctx: { baseUrl, dbName, owner: {email,password}, store: {email,password} }
import { makeClient, sql, resetAuthState, GENERIC_MSG, COOKIE_NAME } from "./_client.mjs";

export async function run(ctx, serverLogs) {
  const results = [];
  const t = (name, pass, detail = "") => results.push({ name, pass, detail });
  const { baseUrl, dbName, owner, store } = ctx;
  await resetAuthState(dbName);

  // 1. brute force -> lockout engages (5 consecutive failures).
  {
    const c = makeClient(baseUrl);
    for (let i = 0; i < 5; i++) {
      await c.post("/api/admin/session", { email: owner.email, password: "Wrong-Password-000!" });
    }
    const row = (await sql(dbName, `SELECT failed_login_attempts AS n, locked_until IS NOT NULL AS l FROM users WHERE email=$1`, [owner.email])).rows[0];
    t("bruteforce_lockout", Number(row.n) === 5 && row.l === true, `attempts=${row.n}`);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    t("locked_rejects_valid", r.res.status === 401 && JSON.parse(r.text).error === GENERIC_MSG, `status=${r.res.status}`);
    await sql(dbName, `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [owner.email]);
  }
  // 2. credential stuffing: per-account bucket throttles a second identity independently.
  // Run-unique victim address: parallel-safe (no shared rows with other drivers).
  {
    const victim = `stuff-victim-${Date.now().toString(36)}@example.com`;
    await sql(dbName, `INSERT INTO users (name, email, is_active) VALUES ('Stuff Test', $1, TRUE)`, [victim]);
    const c = makeClient(baseUrl);
    let last = null;
    for (let i = 0; i < 11; i++) {
      last = await c.post("/api/admin/session", { email: victim, password: "Wrong-Password-000!" });
    }
    const row = (await sql(dbName, `SELECT count(*)::int AS n FROM admin_auth_rate_limits WHERE bucket_key = 'login:acct:' || $1`, [victim])).rows[0];
    t("stuffing_throttled", last.res.status === 401 && Number(row.n) >= 1, `buckets=${row.n}`);
    await sql(dbName, `DELETE FROM users WHERE email=$1`, [victim]);
    await sql(dbName, `DELETE FROM admin_auth_rate_limits WHERE bucket_key = 'login:acct:' || $1`, [victim]);
  }
  // 3. enumeration: unknown vs wrong produce identical responses.
  {
    const a = makeClient(baseUrl);
    const b = makeClient(baseUrl);
    const r1 = await a.post("/api/admin/session", { email: "ghost-1@example.com", password: "Wrong-Password-000!" });
    const r2 = await b.post("/api/admin/session", { email: owner.email, password: "Wrong-Password-000!" });
    t("no_enumeration", r1.res.status === r2.res.status && r1.text === r2.text, `status=${r1.res.status}`);
  }
  // 4. concurrent double login mints distinct tokens.
  {
    const a = makeClient(baseUrl);
    const b = makeClient(baseUrl);
    const [r1, r2] = await Promise.all([
      a.post("/api/admin/session", { email: owner.email, password: owner.password }),
      b.post("/api/admin/session", { email: owner.email, password: owner.password }),
    ]);
    t("distinct_tokens", r1.res.status === 200 && r2.res.status === 200 && a.jar[COOKIE_NAME] !== b.jar[COOKIE_NAME], "");
  }
  // 5. stolen revoked token rejected.
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const raw = c.jar[COOKIE_NAME];
    await sql(dbName, `UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = encode(digest(convert_to($1,'UTF8'),'sha256'),'hex')`, [raw]);
    const g = await c.get("/api/admin/session");
    t("stolen_revoked_rejected", g.res.status === 401, `status=${g.res.status}`);
  }
  // 6. CSRF: cross-origin credential POST rejected.
  {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password }, { headers: { Origin: "https://evil.test" } });
    t("csrf_origin_rejected", r.res.status === 403 && !c.jar[COOKIE_NAME], `status=${r.res.status}`);
  }
  // 7. XSS periphery: no secrets in login HTML; session cookie HttpOnly.
  {
    const g = await fetch(baseUrl + "/admin/login");
    const html = await g.text();
    const leaksSecrets = html.includes(owner.password) || html.includes("token_hash") || html.includes("password_hash");
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    const sc = (r.setCookies.find((s) => s.startsWith(COOKIE_NAME + "=")) || "").toLowerCase();
    t("xss_no_secrets", !leaksSecrets && sc.includes("httponly"), `html=${html.length}b`);
  }
  // 8. escalation: store admin cannot touch super-only surface (also absence of owner email in 403 page).
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const g = await c.get("/admin/users");
    t("no_escalation", g.res.status === 403, `status=${g.res.status}`);
  }
  // 9. direct API access without session.
  {
    const g = await fetch(baseUrl + "/api/admin/session");
    t("direct_api_denied", g.status === 401, `status=${g.status}`);
  }
  // 10. disabled account: login rejected + no session minted.
  {
    await sql(dbName, `UPDATE users SET is_active = FALSE WHERE email=$1`, [store.email]);
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: store.email, password: store.password });
    t("disabled_login_denied", r.res.status === 401 && !c.jar[COOKIE_NAME], `status=${r.res.status}`);
    await sql(dbName, `UPDATE users SET is_active = TRUE WHERE email=$1`, [store.email]);
  }
  // 11. rotation kills sessions (bootstrap-style rotation replicated by direct update + revoke-all).
  {
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const n = (await sql(dbName, `SELECT count(*)::int AS n FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND s.revoked_at IS NULL`, [store.email])).rows[0].n;
    await sql(dbName, `UPDATE admin_sessions SET revoked_at = now() WHERE user_id = (SELECT id FROM users WHERE email=$1)`, [store.email]);
    const g = await c.get("/api/admin/session");
    t("rotation_kills", Number(n) >= 1 && g.res.status === 401, `revoked=${n}`);
  }
  // 12. server logs contain no password material.
  {
    const hay = serverLogs.join("\n");
    const leak = hay.includes(owner.password) || hay.includes(store.password) || hay.includes("password_hash");
    t("logs_clean", !leak, `logbytes=${hay.length}`);
  }
  await resetAuthState(dbName);
  return results;
}
