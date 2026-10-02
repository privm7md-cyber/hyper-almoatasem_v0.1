// BA-9 admin API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-admin.mjs --db <name> --port <port>
// Covers: users (list/get/create/patch/password/activate/roles), roles
// (list/get/create/patch/delete/grants + SUPER_ADMIN protection),
// permissions registry reads, settings reads + typed updates, audit feed
// (filters/pagination/immutability/no-secret payloads), and the full
// anon/store/owner/roleless matrix (store lacks the 7 security keys).
// All rows BA9-prefixed; users/roles removed in cleanup (audit history
// stays by design — actors pinned, entities referenced by id only).
// Prints JSON, never passwords, hashes, or tokens.
import "dotenv/config";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "admin", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const BARE_EMAIL = "bare-cat-test@example.com";
const BARE_PW = "Cat-Test-Bare-Pass-0003!";
const UNKNOWN = "04800000-0000-7000-8000-000000009999";
const SUPER_ADMIN_ID = "02800000-0000-7000-8000-000000000001";

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const probe = await fetch(`${baseUrl}/api/admin/session`, { method: "GET" });
    await probe.text();
  } catch {
    console.error(`REFUSED_NO_SERVER: nothing listening at ${baseUrl}`);
    process.exit(1);
  }
  const scratchUrl = (() => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const db = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 5000 });
  await db.connect();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;

  const get = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const del = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers: cookie ? { cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const m = (r.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, cookie: m ? `__Host-admin-session=${m[1]}` : null };
  };

  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const userIds = new Set();
  const roleIds = new Set();
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash");

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("logins-ok", owner.status === 201 && store.status === 201 && bare.status === 201);

    // ---------- users ----------
    const ulist = await get(`/api/admin/users?limit=5`, owner.cookie);
    t("users-list-200", ulist.status === 200 && ulist.body.data.some((u) => u.email === OWNER_EMAIL)
      && ulist.body.data.every((u) => noSecrets(u)));
    const uAnon = await get(`/api/admin/users?limit=5`);
    t("users-anon-401", uAnon.status === 401);
    const uStore = await get(`/api/admin/users?limit=5`, store.cookie);
    t("users-store-403", uStore.status === 403);
    const uBare = await get(`/api/admin/users?limit=5`, bare.cookie);
    t("users-bare-403", uBare.status === 403);
    const uSearch = await get(`/api/admin/users?search=${encodeURIComponent("owner@hyper")}&limit=5`, owner.cookie);
    t("users-search-200", uSearch.status === 200 && uSearch.body.data.length >= 1);
    const uBadPage = await get(`/api/admin/users?limit=500`, owner.cookie);
    t("users-bad-page-400", uBadPage.status === 400);
    const uMiss = await get(`/api/admin/users/${UNKNOWN}`, owner.cookie);
    t("users-unknown-404", uMiss.status === 404);
    const uMal = await get(`/api/admin/users/not-a-uuid`, owner.cookie);
    t("users-malformed-400", uMal.status === 400);

    const stamp = Date.now().toString(36);
    const u1 = await post(`/api/admin/users`, { name: "BA9 One", email: `ba9-one-${stamp}@example.com`, phone: "201013330001" }, owner.cookie);
    t("users-create-201", u1.status === 201 && isUuid(u1.body.data.id) && u1.body.data.roles.length === 0 && noSecrets(u1.body));
    const idU1 = u1.body.data.id;
    userIds.add(idU1);
    const uDup = await post(`/api/admin/users`, { name: "BA9 Dup", email: `ba9-one-${stamp}@example.com` }, owner.cookie);
    t("users-dup-email-409", uDup.status === 409);
    const uBadEm = await post(`/api/admin/users`, { name: "BA9", email: "not-an-email" }, owner.cookie);
    t("users-bad-email-400", uBadEm.status === 400);
    const uBlank = await post(`/api/admin/users`, { name: "  ", email: `ba9-x-${stamp}@example.com` }, owner.cookie);
    t("users-blank-name-400", uBlank.status === 400);
    const uExtra = await post(`/api/admin/users`, { name: "BA9", email: `ba9-y-${stamp}@example.com`, passwordHash: "x" }, owner.cookie);
    t("users-strict-400", uExtra.status === 400);
    const uStoreCreate = await post(`/api/admin/users`, { name: "BA9", email: `ba9-z-${stamp}@example.com` }, store.cookie);
    t("users-store-create-403", uStoreCreate.status === 403);

    const uPatch = await patch(`/api/admin/users/${idU1}`, { name: "BA9 Uno", phone: null }, owner.cookie);
    t("users-patch-200", uPatch.status === 200 && uPatch.body.data.name === "BA9 Uno" && uPatch.body.data.phone === null);
    const uPatchDup = await patch(`/api/admin/users/${idU1}`, { email: OWNER_EMAIL }, owner.cookie);
    t("users-patch-dup-409", uPatchDup.status === 409);
    const uPatchMiss = await patch(`/api/admin/users/${UNKNOWN}`, { name: "Z" }, owner.cookie);
    t("users-patch-404", uPatchMiss.status === 404);

    const pwWeak = await post(`/api/admin/users/${idU1}/password`, { password: "short" }, owner.cookie);
    t("password-weak-422", pwWeak.status === 422);
    const pwMiss = await post(`/api/admin/users/${UNKNOWN}/password`, { password: "Ba9-Provision-Pass-0001!" }, owner.cookie);
    t("password-unknown-404", pwMiss.status === 404);
    const pwOk = await post(`/api/admin/users/${idU1}/password`, { password: "Ba9-Provision-Pass-0001!" }, owner.cookie);
    t("password-set-200", pwOk.status === 200 && noSecrets(pwOk.body));
    const hashRow = await q(`SELECT password_hash AS h FROM users WHERE id = $1`, [idU1]);
    t("password-hashed", typeof hashRow[0].h === "string" && hashRow[0].h.startsWith("$argon2id$"));
    const loginNew = await loginAs(`ba9-one-${stamp}@example.com`, "Ba9-Provision-Pass-0001!");
    t("provisioned-login-201", loginNew.status === 201);
    const deact = await patch(`/api/admin/users/${idU1}`, { isActive: false }, owner.cookie);
    t("users-deactivate-200", deact.status === 200 && deact.body.data.isActive === false);
    const loginOff = await loginAs(`ba9-one-${stamp}@example.com`, "Ba9-Provision-Pass-0001!");
    t("deactivated-login-401", loginOff.status === 401);
    await patch(`/api/admin/users/${idU1}`, { isActive: true }, owner.cookie);

    // ---------- roles ----------
    const rlist = await get(`/api/admin/roles?limit=10`, owner.cookie);
    t("roles-list-200", rlist.status === 200 && rlist.body.data.some((r) => r.name === "SUPER_ADMIN"));
    const rAnon = await get(`/api/admin/roles?limit=5`);
    t("roles-anon-401", rAnon.status === 401);
    const rStore = await get(`/api/admin/roles?limit=5`, store.cookie);
    t("roles-store-403", rStore.status === 403);
    const rSuper = await get(`/api/admin/roles/${SUPER_ADMIN_ID}`, owner.cookie);
    t("roles-super-31", rSuper.status === 200 && rSuper.body.data.permissions.length === 31);
    const rMiss = await get(`/api/admin/roles/${UNKNOWN}`, owner.cookie);
    t("roles-unknown-404", rMiss.status === 404);
    const r1 = await post(`/api/admin/roles`, { name: `BA9_OPS_${stamp}`.toUpperCase(), description: "test ops" }, owner.cookie);
    t("roles-create-201", r1.status === 201 && isUuid(r1.body.data.id));
    const idR1 = r1.body.data.id;
    roleIds.add(idR1);
    const rDup = await post(`/api/admin/roles`, { name: `BA9_OPS_${stamp}`.toUpperCase() }, owner.cookie);
    t("roles-dup-409", rDup.status === 409);
    const rSpace = await post(`/api/admin/roles`, { name: "has space" }, owner.cookie);
    t("roles-space-400", rSpace.status === 400);
    const rPatch = await patch(`/api/admin/roles/${idR1}`, { description: "ops v2" }, owner.cookie);
    t("roles-patch-200", rPatch.status === 200);
    const rRenameSuper = await patch(`/api/admin/roles/${SUPER_ADMIN_ID}`, { name: "ROOT" }, owner.cookie);
    t("super-rename-403", rRenameSuper.status === 403);
    const rDelSuper = await del(`/api/admin/roles/${SUPER_ADMIN_ID}`, owner.cookie);
    t("super-delete-403", rDelSuper.status === 403);

    // grants + user assignment
    const permRow = await q(`SELECT id FROM permissions WHERE key = 'reports.view'`);
    const idPerm = permRow[0].id;
    const g1 = await post(`/api/admin/roles/${idR1}/grants`, { permissionId: idPerm }, owner.cookie);
    t("grant-create-201", g1.status === 201);
    const gDup = await post(`/api/admin/roles/${idR1}/grants`, { permissionId: idPerm }, owner.cookie);
    t("grant-dup-409", gDup.status === 409);
    const gBadPerm = await post(`/api/admin/roles/${idR1}/grants`, { permissionId: UNKNOWN }, owner.cookie);
    t("grant-unknown-perm-404", gBadPerm.status === 404);
    const gBadRole = await post(`/api/admin/roles/${UNKNOWN}/grants`, { permissionId: idPerm }, owner.cookie);
    t("grant-unknown-role-404", gBadRole.status === 404);
    const a1 = await post(`/api/admin/users/${idU1}/roles`, { roleId: idR1 }, owner.cookie);
    t("assign-201", a1.status === 201);
    const aDup = await post(`/api/admin/users/${idU1}/roles`, { roleId: idR1 }, owner.cookie);
    t("assign-dup-409", aDup.status === 409);
    const aBadRole = await post(`/api/admin/users/${idU1}/roles`, { roleId: UNKNOWN }, owner.cookie);
    t("assign-unknown-role-404", aBadRole.status === 404);
    const uWithRole = await get(`/api/admin/users/${idU1}`, owner.cookie);
    t("user-shows-role", uWithRole.status === 200 && uWithRole.body.data.roles.includes(`BA9_OPS_${stamp}`.toUpperCase()));
    const rDelHeld = await del(`/api/admin/roles/${idR1}`, owner.cookie);
    t("delete-granted-409", rDelHeld.status === 409);
    const rmGrant = await del(`/api/admin/roles/${idR1}/grants/${idPerm}`, owner.cookie);
    t("grant-remove-200", rmGrant.status === 200);
    const rmGrantMiss = await del(`/api/admin/roles/${idR1}/grants/${idPerm}`, owner.cookie);
    t("grant-remove-404", rmGrantMiss.status === 404);
    const rmAssign = await del(`/api/admin/users/${idU1}/roles/${idR1}`, owner.cookie);
    t("assign-remove-200", rmAssign.status === 200);
    const rmAssignMiss = await del(`/api/admin/users/${idU1}/roles/${idR1}`, owner.cookie);
    t("assign-remove-404", rmAssignMiss.status === 404);
    const rDel = await del(`/api/admin/roles/${idR1}`, owner.cookie);
    t("roles-delete-200", rDel.status === 200);
    roleIds.delete(idR1);
    const rDelMiss = await del(`/api/admin/roles/${UNKNOWN}`, owner.cookie);
    t("roles-delete-404", rDelMiss.status === 404);

    // ---------- permissions registry ----------
    const plist = await get(`/api/admin/permissions?limit=100`, owner.cookie);
    t("permissions-31", plist.status === 200 && plist.body.data.length === 31
      && plist.body.data.some((p) => p.key === "orders.cancel"));
    const pOne = await get(`/api/admin/permissions/${idPerm}`, owner.cookie);
    t("permission-get-200", pOne.status === 200 && pOne.body.data.key === "reports.view");
    const pMiss = await get(`/api/admin/permissions/${UNKNOWN}`, owner.cookie);
    t("permission-unknown-404", pMiss.status === 404);
    const pAnon = await get(`/api/admin/permissions?limit=5`);
    t("permissions-anon-401", pAnon.status === 401);
    const pStore = await get(`/api/admin/permissions?limit=5`, store.cookie);
    t("permissions-store-403", pStore.status === 403);

    // ---------- settings ----------
    const slist = await get(`/api/admin/settings`, owner.cookie);
    t("settings-list-8", slist.status === 200 && slist.body.data.length === 8
      && slist.body.data.some((s) => s.key === "delivery.default_fee" && s.value === "20.00" && s.valueType === "NUMERIC"));
    const sOne = await get(`/api/admin/settings/delivery.enabled`, owner.cookie);
    t("settings-get-200", sOne.status === 200 && sOne.body.data.valueType === "BOOLEAN");
    const sMiss = await get(`/api/admin/settings/no.such.key`, owner.cookie);
    t("settings-unknown-404", sMiss.status === 404);
    const sAnon = await get(`/api/admin/settings`, null);
    t("settings-anon-401", sAnon.status === 401);
    const sStore = await get(`/api/admin/settings`, store.cookie);
    t("settings-store-403", sStore.status === 403);
    const sBadType = await patch(`/api/admin/settings/delivery.enabled`, { value: "yes" }, owner.cookie);
    t("settings-bad-type-422", sBadType.status === 422);
    const sBadInt = await patch(`/api/admin/settings/orders.auto_cancel_minutes`, { value: "abc" }, owner.cookie);
    t("settings-bad-int-422", sBadInt.status === 422);
    const sMissPatch = await patch(`/api/admin/settings/no.such.key`, { value: "x" }, owner.cookie);
    t("settings-patch-404", sMissPatch.status === 404);
    const sToggle = await patch(`/api/admin/settings/delivery.enabled`, { value: "true" }, owner.cookie);
    t("settings-update-200", sToggle.status === 200 && sToggle.body.data.value === "true");
    const sAudit = await q(`SELECT action, entity_type FROM audit_logs WHERE action = 'settings.update' ORDER BY created_at DESC LIMIT 1`);
    t("settings-audit-row", sAudit.length === 1 && sAudit[0].entity_type === "store_settings");
    await patch(`/api/admin/settings/delivery.enabled`, { value: "false" }, owner.cookie);
    const sRestore = await get(`/api/admin/settings/delivery.enabled`, owner.cookie);
    t("settings-restored", sRestore.body.data.value === "false");

    // ---------- audit feed ----------
    const alist = await get(`/api/admin/audit-logs?limit=5`, owner.cookie);
    t("audit-list-200", alist.status === 200 && Array.isArray(alist.body.data) && alist.body.data.length >= 1
      && alist.body.data[0].action !== undefined && alist.body.data[0].actorType !== undefined);
    const aFilter = await get(`/api/admin/audit-logs?action=users.create&limit=20`, owner.cookie);
    t("audit-filter-action", aFilter.status === 200 && aFilter.body.data.every((a) => a.action === "users.create")
      && aFilter.body.data.some((a) => a.entityId === idU1));
    const aEntity = await get(`/api/admin/audit-logs?entityType=users&entityId=${idU1}&limit=20`, owner.cookie);
    t("audit-filter-entity", aEntity.status === 200 && aEntity.body.data.length >= 1);
    const aPage = await get(`/api/admin/audit-logs?limit=1`, owner.cookie);
    t("audit-pagination", aPage.status === 200 && aPage.body.data.length === 1 && typeof aPage.body.meta.nextCursor === "string");
    const aBadPage = await get(`/api/admin/audit-logs?limit=500`, owner.cookie);
    t("audit-bad-page-400", aBadPage.status === 400);
    const aBadDate = await get(`/api/admin/audit-logs?since=yesterday&limit=5`, owner.cookie);
    t("audit-bad-date-400", aBadDate.status === 400);
    const aOne = await get(`/api/admin/audit-logs/${aFilter.body.data[0].id}`, owner.cookie);
    t("audit-get-200", aOne.status === 200 && aOne.body.data.id === aFilter.body.data[0].id);
    t("audit-no-secrets", noSecrets(aFilter.body));
    const aMiss = await get(`/api/admin/audit-logs/${UNKNOWN}`, owner.cookie);
    t("audit-unknown-404", aMiss.status === 404);
    const aAnon = await get(`/api/admin/audit-logs?limit=5`);
    t("audit-anon-401", aAnon.status === 401);
    const aStore = await get(`/api/admin/audit-logs?limit=5`, store.cookie);
    t("audit-store-403", aStore.status === 403);
    const aBare = await get(`/api/admin/audit-logs?limit=5`, bare.cookie);
    t("audit-bare-403", aBare.status === 403);
    const aPatch = await fetch(`${baseUrl}/api/admin/audit-logs/${aFilter.body.data[0].id}`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: owner.cookie }, body: JSON.stringify({}),
    });
    t("audit-immutable", aPatch.status === 404 || aPatch.status === 405);
  } finally {
    // Hygiene: remove BA-9 rows (mappings → users/roles). Audit history
    // stays by design (actors pinned, entities referenced by id only).
    // Sessions for removed users revoked first (RESTRICT pins actors).
    try {
      for (const uid of userIds) {
        // Test-actor audit rows go first: any login attempt pins the user
        // via RESTRICT (same scratch-hygiene pattern as BA-2..BA-8 suites;
        // owner-actor history rows stay untouched).
        await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
        // Entity-side rows for removed test users (BA-A: owner-actor history
        // references entities by id only — drop this suite's own so later
        // audit-feed pages stay deterministic).
        await db.query(`DELETE FROM audit_logs WHERE entity_id = $1`, [uid]).catch(() => {});
      }
      for (const rid of roleIds) {
        await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM roles WHERE id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM audit_logs WHERE entity_id = $1`, [rid]).catch(() => {});
      }
      for (const email of [OWNER_EMAIL, STORE_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`ADMIN_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
