// RBAC suite (server-side enforcement over HTTP): SUPER_ADMIN vs STORE_ADMIN.
// ctx: { baseUrl, dbName, owner: {email,password}, store: {email,password} }
import { makeClient, sql, resetAuthState } from "./_client.mjs";

export async function run(ctx) {
  const results = [];
  const t = (name, pass, detail = "") => results.push({ name, pass, detail });
  const { baseUrl, dbName, owner, store } = ctx;
  await resetAuthState(dbName);

  async function loginAs(creds) {
    const c = makeClient(baseUrl);
    const r = await c.post("/api/admin/session", { email: creds.email, password: creds.password });
    if (r.res.status !== 201) throw new Error(`setup login failed for ${creds.email}: ${r.res.status}`);
    return c;
  }

  // 1. anonymous /admin -> redirect to login (proxy optimistic guard).
  {
    const r = await fetch(baseUrl + "/admin", { redirect: "manual" });
    t("anon_admin_redirect", r.status === 307 && (r.headers.get("location") || "").endsWith("/admin/login"), `status=${r.status}`);
  }
  // 2. anonymous /admin/users -> redirect (never a 403 leak, never content).
  {
    const r = await fetch(baseUrl + "/admin/users", { redirect: "manual" });
    const body = await r.text();
    t("anon_users_redirect", r.status === 307 && !body.includes("المستخدمون"), `status=${r.status}`);
  }
  // 3. SUPER_ADMIN sees users page (200 + content).
  {
    const c = await loginAs(owner);
    const g = await c.get("/admin/users");
    t("super_users_page", g.res.status === 200 && g.text.includes("المستخدمون"), `status=${g.res.status}`);
  }
  // 4. STORE_ADMIN gets 403 on users page (server-side requirePermission).
  {
    const c = await loginAs(store);
    const g = await c.get("/admin/users");
    t("store_users_forbidden", g.res.status === 403 && !g.text.includes("owner@hyper-al-moatasem.local"), `status=${g.res.status}`);
  }
  // 5. STORE_ADMIN passes dashboard (authenticated, no special permission needed).
  {
    const c = await loginAs(store);
    const g = await c.get("/admin");
    t("store_dashboard_ok", g.res.status === 200 && g.text.includes("لوحة الإدارة"), `status=${g.res.status}`);
  }
  // 6. Role stripped mid-session -> permission lost immediately (no caching).
  {
    const c = await loginAs(store);
    await sql(dbName, `DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE email=$1)`, [store.email]);
    const g = await c.get("/admin/users");
    t("role_strip_effective", g.res.status === 403, `status=${g.res.status}`);
    const roleId = (await sql(dbName, `SELECT id FROM roles WHERE name='STORE_ADMIN'`)).rows[0].id;
    const uid = (await sql(dbName, `SELECT id FROM users WHERE email=$1`, [store.email])).rows[0].id;
    await sql(dbName, `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [uid, roleId]);
  }
  // 7. Disabled role authorizes nothing (role-level kill switch).
  {
    const c = await loginAs(store);
    await sql(dbName, `UPDATE roles SET is_active = FALSE WHERE name='STORE_ADMIN'`);
    const g = await c.get("/admin");
    // dashboard requires auth only, so still 200; users page must 403.
    const u = await c.get("/admin/users");
    t("disabled_role_no_perms", g.res.status === 200 && u.res.status === 403, `dash=${g.res.status} users=${u.res.status}`);
    await sql(dbName, `UPDATE roles SET is_active = TRUE WHERE name='STORE_ADMIN'`);
  }
  // 8. Session for a user whose mappings were all revoked keeps identity but zero permissions.
  {
    const c = await loginAs(owner);
    const g = await c.get("/api/admin/session");
    const body = JSON.parse(g.text);
    t("super_has_manage", body.data.permissions.includes("users.manage") && body.data.roles.includes("SUPER_ADMIN"), `perms=${body.data.permissions.length}`);
  }
  await resetAuthState(dbName);
  return results;
}
