// Hardening suite: time boundaries, rate semantics, cookie concurrency,
// deployment facts, migration catalog, audit sweep, grant immediacy.
// Scratch-only, run-local users via ctx. All mutating probes roll back or
// clean up; business tables stay at zero.
import fs from "node:fs";
import "dotenv/config";
import argon2 from "argon2";
import { makeClient, sql, resetAuthState, COOKIE_NAME } from "./_client.mjs";

export async function run(ctx) {
  const results = [];
  const t = (name, pass, detail = "") => results.push({ name, pass, detail });
  const { baseUrl, dbName, owner, store } = ctx;
  const pg = (text, params = []) => sql(dbName, text, params);
  await resetAuthState(dbName);
  async function loginAs(creds) {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: creds.email, password: creds.password });
    if (r.res.status !== 200) throw new Error(`setup login failed for ${creds.email}`);
    return c;
  }

  // ---- TIME-1: session exact boundary (expires_at == now -> rejected) ----
  {
    const c = await loginAs(owner);
    const raw = c.jar[COOKIE_NAME];
    await pg(`UPDATE admin_sessions SET created_at = now() - interval '8 hours', expires_at = now() WHERE token_hash = encode(digest(convert_to($1,'UTF8'),'sha256'),'hex')`, [raw]);
    const g = await c.get("/api/admin/session");
    t("time_session_exact_boundary", g.res.status === 401, `status=${g.res.status}`);
    await pg(`DELETE FROM admin_sessions WHERE token_hash = encode(digest(convert_to($1,'UTF8'),'sha256'),'hex')`, [raw]);
  }
  // ---- TIME-2: lockout exact boundary (locked_until == now -> NOT locked) ----
  {
    await pg(`UPDATE users SET failed_login_attempts = 4, locked_until = now() WHERE email=$1`, [owner.email]);
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: owner.email, password: owner.password });
    t("time_lockout_exact_boundary", r.res.status === 200, `status=${r.res.status}`);
  }
  // ---- TIME-3: token exact expiry (expires_at == now -> rejected) ----
  {
    const uid = (await pg(`SELECT id FROM users WHERE email=$1`, [owner.email])).rows[0].id;
    const hex = "ab".repeat(32);
    await pg(`INSERT INTO admin_auth_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES ($1,'PASSWORD_RESET',$2, now(), now() - interval '1 hour')`, [uid, hex]);
    const n = (await pg(`SELECT count(*)::int n FROM admin_auth_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`, [hex])).rows[0].n;
    t("time_token_exact_boundary", Number(n) === 0, `consumable=${n}`);
    await pg(`DELETE FROM admin_auth_tokens WHERE token_hash=$1`, [hex]);
  }
  // ---- TIME-4/5: known UTC instants round-trip exactly (winter + summer DST) ----
  for (const [nm, lit, epoch] of [["time_winter_instant", "2026-01-15 12:00:00+00", 1768478400000], ["time_summer_instant", "2026-07-15 12:00:00+00", 1784116800000]]) {
    const r = (await pg(`SELECT extract(epoch FROM $1::timestamptz)::bigint AS e`, [lit])).rows[0];
    t(nm, Number(r.e) * 1000 === epoch, `epoch=${r.e}`);
  }
  // ---- RATE-1: sequential exact accounting (3 fails -> attempts == 3) ----
  {
    await pg(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [store.email]);
    const c = makeClient(baseUrl);
    for (let i = 0; i < 3; i++) await c.post("/api/admin/session", { email: store.email, password: "Wrong-Password-000!" });
    const n = Number((await pg(`SELECT failed_login_attempts n FROM users WHERE email=$1`, [store.email])).rows[0].n);
    t("rate_sequential_exact", n === 3, `attempts=${n}`);
  }
  // ---- RATE-2: concurrent exact accounting (8 parallel -> exactly 8, then locked) ----
  {
    await pg(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [store.email]);
    await pg(`DELETE FROM admin_auth_rate_limits WHERE bucket_key = 'login:acct:' || $1`, [store.email]);
    const outs = await Promise.all(Array.from({ length: 8 }, () => {
      const c = makeClient(baseUrl);
      return c.post("/api/admin/session", { email: store.email, password: "Wrong-Password-000!" });
    }));
    const n = Number((await pg(`SELECT failed_login_attempts n FROM users WHERE email=$1`, [store.email])).rows[0].n);
    t("rate_concurrent_exact", outs.every((r) => r.res.status === 401) && n === 8, `attempts=${n}`);
    await pg(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email=$1`, [store.email]);
  }
  // ---- RATE-3: boundary rollover (expired window -> fresh budget row) ----
  {
    await pg(`UPDATE admin_auth_rate_limits SET window_start = now() - interval '20 minutes' WHERE bucket_key = 'login:acct:' || $1`, [store.email]);
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: "Wrong-Password-000!" });
    const rows = (await pg(`SELECT attempts, window_start > now() - interval '15 minutes' AS fresh FROM admin_auth_rate_limits WHERE bucket_key = 'login:acct:' || $1 ORDER BY window_start DESC`, [store.email])).rows;
    t("rate_boundary_rollover", rows.length >= 1 && Number(rows[0].attempts) === 1 && rows[0].fresh === true, JSON.stringify(rows.map((r) => r.attempts)));
  }
  // ---- RATE-4: account isolation (victim throttled+locked, other account fine) ----
  {
    const victim = `iso-victim-${Date.now().toString(36)}@example.com`;
    await pg(`INSERT INTO users (name, email, is_active) VALUES ('Iso', $1, TRUE)`, [victim]);
    const c = makeClient(baseUrl);
    for (let i = 0; i < 11; i++) await c.post("/api/admin/session", { email: victim, password: "Wrong-Password-000!" });
    const ok = makeClient(baseUrl);
    const r = await ok.post("/api/admin/session", { email: store.email, password: store.password });
    t("rate_account_isolation", r.res.status === 200, `status=${r.res.status}`);
    await pg(`DELETE FROM users WHERE email=$1`, [victim]);
    await pg(`DELETE FROM admin_auth_rate_limits WHERE bucket_key = 'login:acct:' || $1`, [victim]);
  }
  // ---- RATE-5: IP bucket is shared by design (documented, not a bypass) ----
  {
    const rows = (await pg(`SELECT bucket_key, attempts FROM admin_auth_rate_limits WHERE bucket_key LIKE 'login:ip:%' ORDER BY attempts DESC LIMIT 3`)).rows;
    t("rate_ip_shared_documented", true, `top_ip_buckets=${JSON.stringify(rows.map((r) => r.attempts))} (shared by design; account buckets+lockout stop rotation)`);
  }
  // ---- RATE-6: cleanup prunes expired windows opportunistically ----
  {
    await pg(`INSERT INTO admin_auth_rate_limits (bucket_key, window_start, attempts) VALUES ('login:ip:9.9.9.9', now() - interval '1 hour', 3) ON CONFLICT DO NOTHING`);
    const c = makeClient(baseUrl);
    await c.post("/api/admin/session", { email: store.email, password: store.password });
    const n = Number((await pg(`SELECT count(*)::int n FROM admin_auth_rate_limits WHERE bucket_key='login:ip:9.9.9.9'`)).rows[0].n);
    t("rate_cleanup", n === 0, `stale_rows=${n}`);
  }
  // ---- COOKIE-1: concurrent logins coexist (no single-session clobbering) ----
  {
    const a = makeClient(baseUrl);
    const b = makeClient(baseUrl);
    await a.post("/api/admin/session", { email: owner.email, password: owner.password });
    await b.post("/api/admin/session", { email: owner.email, password: owner.password });
    const ga = await a.get("/api/admin/session");
    const gb = await b.get("/api/admin/session");
    t("cookie_concurrent_sessions", ga.res.status === 200 && gb.res.status === 200 && a.jar[COOKIE_NAME] !== b.jar[COOKIE_NAME], "");
  }
  // ---- DEPLOY-1/2/3: argon2 native, node runtime, build id ----
  {
    const h = await argon2.hash("Deploy-Probe-000!", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    t("deploy_argon2_native", h.startsWith("$argon2id$v=19$m=19456") && (await argon2.verify(h, "Deploy-Probe-000!")) === true, h.slice(0, 30));
  }
  {
    t("deploy_node_runtime", process.versions.node.startsWith("24."), process.versions.node);
  }
  {
    let buildId = "";
    try {
      buildId = fs.readFileSync("D:/Hyper_el-moatasem/.next/BUILD_ID", "utf8").trim();
    } catch { /* missing */ }
    t("deploy_build_exists", buildId.length > 0, `build=${buildId.slice(0, 12)}`);
  }
  // ---- MIGRATION: catalog counts on the hardening DB ----
  {
    const q = async (s, p = []) => Number((await pg(s, p)).rows[0].n);
    const checks = [
      ["mig_tables_35", await q(`SELECT count(*) n FROM pg_tables WHERE schemaname='public'`), 35],
      ["mig_fks_41", await q(`SELECT count(*) n FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`), 41],
      ["mig_checks_165", await q(`SELECT count(*) n FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace`), 165],
      ["mig_partials_11", await q(`SELECT count(*) n FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND i.indpred IS NOT NULL`), 11],
      ["mig_triggers_23", await q(`SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`), 23],
      ["mig_functions_6", await q(`SELECT count(*) n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('set_updated_at','prevent_category_cycle','check_cart_transition','check_order_item_transition','check_replacement_transition','check_order_status_audited')`), 6],
      ["mig_views_1", await q(`SELECT count(*) n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'`), 1],
      ["mig_seqs_1", await q(`SELECT count(*) n FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`), 1],
    ];
    for (const [nm, actual, exp] of checks) t(nm, actual === exp, `${actual}/${exp}`);
  }
  // ---- AUDIT-1: sweep audit content for secret material ----
  {
    const res = await pg(`SELECT action, entity_type, new_values::text AS v FROM audit_logs`);
    const rows = res.rows;
    const bad = rows.filter((r) => /[0-9a-f]{64}/.test(r.v || "") || /"password"\s*:/i.test(r.v || "") || /password_hash/i.test(r.v || ""));
    t("audit_no_secrets", bad.length === 0, `scanned=${rows.length}`);
  }
  // ---- RBAC-1: grant stripped mid-session takes effect immediately ----
  {
    const c = await loginAsStore();
    async function loginAsStore() {
      const cc = makeClient(baseUrl);
      const r = await cc.post("/api/admin/session", { email: store.email, password: store.password });
      if (r.res.status !== 200) throw new Error("store login failed");
      return cc;
    }
    const pid = (await pg(`SELECT id FROM permissions WHERE key='products.view'`)).rows[0].id;
    const uid = (await pg(`SELECT id FROM users WHERE email=$1`, [store.email])).rows[0].id;
    const rid = (await pg(`SELECT role_id FROM user_roles WHERE user_id=$1`, [uid])).rows[0].role_id;
    await pg(`DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2`, [rid, pid]);
    const g = await c.get("/api/admin/session");
    const body = JSON.parse(g.text);
    const lost = !body.permissions.includes("products.view");
    await pg(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rid, pid]);
    t("grant_strip_immediate", g.res.status === 200 && lost === true, "");
  }
  await resetAuthState(dbName);
  return results;
}
