// PRE-BA-11 RBAC safety-guard suite (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-rbac-guards.mjs --db <name> --port <port>
// Covers human decision #1:
//   G1 self-deactivation -> 403, no state change, no audit row.
//   G2 final SUPER_ADMIN single request -> 409, remains active, no audit.
//   G3 two holders -> deactivate one -> 200, one remains, audit row exists.
//   G4 final-holder concurrent cross-deactivation race -> exactly one 200,
//      one 409, never zero holders, audit only for the commit.
//   G5 SUPER_ADMIN grant removal -> 403 (+ concurrent double attempt),
//      grants intact, no audit.
//   G6 normal role zero-grant reachability is NOT blocked.
// All rows BA11G-prefixed. Prints JSON, never passwords, hashes, or tokens.
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
  console.log(JSON.stringify({ suite: "rbac-guards", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
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

  const stamp = Date.now().toString(36);
  const userIds = new Set();
  const roleIds = new Set();
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const holders = async () => (await q(`SELECT u.id::text AS id FROM users u
    JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
    WHERE r.name = 'SUPER_ADMIN' AND u.is_active AND u.deleted_at IS NULL
      AND r.is_active AND r.deleted_at IS NULL ORDER BY 1`)).map((r) => r.id);
  const auditDeacts = async (ids) => Number((await q(`SELECT count(*)::int AS n FROM audit_logs
    WHERE action = 'users.update' AND entity_id = ANY($1::uuid[])
      AND new_values->>'isActive' = 'false'`, [ids]))[0].n);
  const ownerRow = async () => (await q(`SELECT id::text AS id, is_active FROM users WHERE email = $1`, [OWNER_EMAIL]))[0];
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("logins-owner-ok", owner.status === 201 && !!owner.cookie, String(owner.status));
    if (owner.status !== 201 || !owner.cookie) {
      console.error(`REFUSED_LOGIN: owner=${owner.status} (rate buckets may be exhausted — retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const cko = owner.cookie;
    const idOwner = (await ownerRow()).id;

    // Second SUPER_ADMIN holder U2.
    const u2 = await post(`/api/admin/users`, { name: "BA11G Two", email: `ba11g-two-${stamp}@example.com` }, cko);
    t("u2-create-201", u2.status === 201 && isUuid(u2.body.data.id), String(u2.status));
    const idU2 = u2.body.data.id;
    userIds.add(idU2);
    const pw2 = await post(`/api/admin/users/${idU2}/password`, { password: "Ba11g-Second-Pass-0001!" }, cko);
    t("u2-password-200", pw2.status === 200, String(pw2.status));
    const as2 = await post(`/api/admin/users/${idU2}/roles`, { roleId: SUPER_ADMIN_ID }, cko);
    t("u2-assign-super-201", as2.status === 201, String(as2.status));
    let ck2 = (await loginAs(`ba11g-two-${stamp}@example.com`, "Ba11g-Second-Pass-0001!")).cookie;
    t("u2-login-200", !!ck2);
    t("two-holders", (await holders()).length === 2, JSON.stringify(await holders()));

    // ---------- G1: self-deactivation ----------
    const audG1Before = await auditDeacts([idOwner]);
    const g1 = await patch(`/api/admin/users/${idOwner}`, { isActive: false }, cko);
    t("g1-self-403", g1.status === 403, String(g1.status));
    t("g1-still-active", (await ownerRow()).is_active === true);
    t("g1-no-audit", (await auditDeacts([idOwner])) === audG1Before);

    // ---------- G2: single final holder, foreign actor ----------
    const rm2 = await del(`/api/admin/users/${idU2}/roles/${SUPER_ADMIN_ID}`, cko);
    t("g2-setup-unassign-200", rm2.status === 200, String(rm2.status));
    t("one-holder", (await holders()).length === 1);
    // Non-SUPER_ADMIN actor holding users.manage only.
    const rHelp = await post(`/api/admin/roles`, { name: `BA11G_HELP_${stamp}`.toUpperCase() }, cko);
    const idHelp = rHelp.body.data.id;
    roleIds.add(idHelp);
    const permUsersManage = (await q(`SELECT id::text AS id FROM permissions WHERE key = 'users.manage'`))[0].id;
    await post(`/api/admin/roles/${idHelp}/grants`, { permissionId: permUsersManage }, cko);
    const uC = await post(`/api/admin/users`, { name: "BA11G Clerk", email: `ba11g-clerk-${stamp}@example.com` }, cko);
    const idC = uC.body.data.id;
    userIds.add(idC);
    await post(`/api/admin/users/${idC}/password`, { password: "Ba11g-Clerk-Pass-0001!" }, cko);
    await post(`/api/admin/users/${idC}/roles`, { roleId: idHelp }, cko);
    const ckC = (await loginAs(`ba11g-clerk-${stamp}@example.com`, "Ba11g-Clerk-Pass-0001!")).cookie;
    t("g2-clerk-login-200", !!ckC);
    const audG2Before = await auditDeacts([idOwner]);
    const g2 = await patch(`/api/admin/users/${idOwner}`, { isActive: false }, ckC);
    t("g2-final-409", g2.status === 409, String(g2.status));
    t("g2-owner-active", (await ownerRow()).is_active === true);
    t("g2-no-audit", (await auditDeacts([idOwner])) === audG2Before);

    // ---------- G3: two holders, deactivate one ----------
    const re2 = await post(`/api/admin/users/${idU2}/roles`, { roleId: SUPER_ADMIN_ID }, cko);
    t("g3-setup-reassign-201", re2.status === 201, String(re2.status));
    ck2 = (await loginAs(`ba11g-two-${stamp}@example.com`, "Ba11g-Second-Pass-0001!")).cookie;
    const audG3Before = await auditDeacts([idU2]);
    const g3 = await patch(`/api/admin/users/${idU2}`, { isActive: false }, cko);
    t("g3-deactivate-200", g3.status === 200 && g3.body.data.isActive === false, String(g3.status));
    t("g3-one-remains", JSON.stringify(await holders()) === JSON.stringify([idOwner]));
    t("g3-audit-exists", (await auditDeacts([idU2])) === audG3Before + 1);
    const reAct = await patch(`/api/admin/users/${idU2}`, { isActive: true }, cko);
    t("g3-reactivate-200", reAct.status === 200, String(reAct.status));
    ck2 = (await loginAs(`ba11g-two-${stamp}@example.com`, "Ba11g-Second-Pass-0001!")).cookie;
    t("g3-two-again", (await holders()).length === 2);

    // ---------- G4: concurrent cross-deactivation race ----------
    const audG4Before = await auditDeacts([idOwner, idU2]);
    const [rA, rB] = await Promise.all([
      patch(`/api/admin/users/${idU2}`, { isActive: false }, cko),
      patch(`/api/admin/users/${idOwner}`, { isActive: false }, ck2),
    ]);
    const codes = [rA.status, rB.status].sort().join(",");
    t("g4-one-wins", codes === "200,409", `${rA.status}/${rB.status}`);
    const afterG4 = await holders();
    t("g4-never-zero", afterG4.length === 1, JSON.stringify(afterG4));
    t("g4-audit-single", (await auditDeacts([idOwner, idU2])) === audG4Before + 1);
    const survivor = afterG4[0] === idOwner ? "owner" : "u2";
    const ckSurv = survivor === "owner"
      ? (await loginAs(OWNER_EMAIL, OWNER_PW)).cookie
      : (await loginAs(`ba11g-two-${stamp}@example.com`, "Ba11g-Second-Pass-0001!")).cookie;
    const loser = survivor === "owner" ? idU2 : idOwner;
    const reLoser = await patch(`/api/admin/users/${loser}`, { isActive: true }, ckSurv);
    t("g4-restore-200", reLoser.status === 200, String(reLoser.status));
    t("g4-two-restored", (await holders()).length === 2);
    const ckOwnerNow = (await loginAs(OWNER_EMAIL, OWNER_PW)).cookie;
    t("g4-owner-login-200", !!ckOwnerNow);

    // ---------- G5: SUPER_ADMIN grant protection ----------
    const permRows = await q(`SELECT id::text AS id, key FROM permissions WHERE key IN ('reports.view', 'notifications.view') ORDER BY key`);
    const revokeCount = async () => Number((await q(`SELECT count(*)::int AS n FROM audit_logs
      WHERE action = 'roles.revoke' AND entity_id = $1::uuid`, [SUPER_ADMIN_ID]))[0].n);
    const grantExists = async (pid) => (await q(`SELECT count(*)::int AS n FROM role_permissions
      WHERE role_id = $1::uuid AND permission_id = $2::uuid`, [SUPER_ADMIN_ID, pid]))[0].n === 1;
    const revBefore = await revokeCount();
    const g5 = await del(`/api/admin/roles/${SUPER_ADMIN_ID}/grants/${permRows[0].id}`, ckOwnerNow);
    t("g5-revoke-403", g5.status === 403, String(g5.status));
    t("g5-grant-intact", await grantExists(permRows[0].id));
    t("g5-no-audit", (await revokeCount()) === revBefore);
    const [g5a, g5b] = await Promise.all([
      del(`/api/admin/roles/${SUPER_ADMIN_ID}/grants/${permRows[0].id}`, ckOwnerNow),
      del(`/api/admin/roles/${SUPER_ADMIN_ID}/grants/${permRows[1].id}`, ckOwnerNow),
    ]);
    t("g5-concurrent-403", g5a.status === 403 && g5b.status === 403, `${g5a.status}/${g5b.status}`);
    t("g5-both-intact", (await grantExists(permRows[0].id)) && (await grantExists(permRows[1].id)));

    // ---------- G6: normal role keeps zero-grant reachability ----------
    const rZ = await post(`/api/admin/roles`, { name: `BA11G_ZERO_${stamp}`.toUpperCase() }, ckOwnerNow);
    const idZ = rZ.body.data.id;
    roleIds.add(idZ);
    await post(`/api/admin/roles/${idZ}/grants`, { permissionId: permRows[0].id }, ckOwnerNow);
    const zRm = await del(`/api/admin/roles/${idZ}/grants/${permRows[0].id}`, ckOwnerNow);
    const zLeft = Number((await q(`SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1::uuid`, [idZ]))[0].n);
    t("g6-zero-allowed", zRm.status === 200 && zLeft === 0, `${zRm.status}/${zLeft}`);

    // ---------- C: effective-permission ceiling ----------
    // OPS actor holds exactly {roles.manage, roles.view, users.view}.
    const permIds = Object.fromEntries((await q(`SELECT key, id::text AS id FROM permissions
      WHERE key IN ('roles.manage','roles.view','users.view','users.manage','reports.view','notifications.view')`)).map((r) => [r.key, r.id]));
    const rOps = await post(`/api/admin/roles`, { name: `BA11G_OPS_${stamp}`.toUpperCase() }, ckOwnerNow);
    const idOps = rOps.body.data.id;
    roleIds.add(idOps);
    for (const k of ["roles.manage", "roles.view", "users.view"]) {
      await post(`/api/admin/roles/${idOps}/grants`, { permissionId: permIds[k] }, ckOwnerNow);
    }
    const uOp = await post(`/api/admin/users`, { name: "BA11G Ops", email: `ba11g-ops-${stamp}@example.com` }, ckOwnerNow);
    const idOp = uOp.body.data.id;
    userIds.add(idOp);
    await post(`/api/admin/users/${idOp}/password`, { password: "Ba11g-Ops-Pass-0001!" }, ckOwnerNow);
    await post(`/api/admin/users/${idOp}/roles`, { roleId: idOps }, ckOwnerNow);
    const ckOp = (await loginAs(`ba11g-ops-${stamp}@example.com`, "Ba11g-Ops-Pass-0001!")).cookie;
    t("c-ops-login-200", !!ckOp);
    const rT1 = await post(`/api/admin/roles`, { name: `BA11G_T1_${stamp}`.toUpperCase() }, ckOwnerNow);
    const idT1 = rT1.body.data.id;
    roleIds.add(idT1);
    const grantCount = async (rid, pid) => Number((await q(`SELECT count(*)::int AS n FROM role_permissions
      WHERE role_id = $1::uuid AND permission_id = $2::uuid`, [rid, pid]))[0].n);
    const grantAud = async (rid) => Number((await q(`SELECT count(*)::int AS n FROM audit_logs
      WHERE action = 'roles.grant' AND entity_id = $1::uuid`, [rid]))[0].n);
    const c1 = await post(`/api/admin/roles/${idT1}/grants`, { permissionId: permIds["users.view"] }, ckOp);
    t("c1-grant-held-201", c1.status === 201 && (await grantCount(idT1, permIds["users.view"])) === 1, String(c1.status));
    const gAudBefore = await grantAud(idT1);
    const c2 = await post(`/api/admin/roles/${idT1}/grants`, { permissionId: permIds["reports.view"] }, ckOp);
    t("c2-grant-missing-403", c2.status === 403, String(c2.status));
    t("c2-zero-mutation", (await grantCount(idT1, permIds["reports.view"])) === 0);
    t("c2-zero-audit", (await grantAud(idT1)) === gAudBefore);
    const c3 = await post(`/api/admin/roles/${idT1}/grants`, { permissionId: permIds["users.manage"] }, ckOp);
    t("c3-grant-missing2-403", c3.status === 403, String(c3.status));
    t("c3-zero-mutation", (await grantCount(idT1, permIds["users.manage"])) === 0);
    const [c4a, c4b] = await Promise.all([
      post(`/api/admin/roles/${idT1}/grants`, { permissionId: permIds["reports.view"] }, ckOp),
      post(`/api/admin/roles/${idT1}/grants`, { permissionId: permIds["notifications.view"] }, ckOp),
    ]);
    t("c4-concurrent-403", c4a.status === 403 && c4b.status === 403, `${c4a.status}/${c4b.status}`);
    t("c4-zero-mutation", (await grantCount(idT1, permIds["reports.view"])) === 0
      && (await grantCount(idT1, permIds["notifications.view"])) === 0);
    const uTu = await post(`/api/admin/users`, { name: "BA11G Target", email: `ba11g-tu-${stamp}@example.com` }, ckOwnerNow);
    const idTu = uTu.body.data.id;
    userIds.add(idTu);
    const rZ2 = await post(`/api/admin/roles`, { name: `BA11G_Z2_${stamp}`.toUpperCase() }, ckOwnerNow);
    const idZ2 = rZ2.body.data.id;
    roleIds.add(idZ2);
    const c5 = await post(`/api/admin/users/${idTu}/roles`, { roleId: idZ2 }, ckOp);
    t("c5-assign-zero-201", c5.status === 201, String(c5.status));
    const rRich = await post(`/api/admin/roles`, { name: `BA11G_RICH_${stamp}`.toUpperCase() }, ckOwnerNow);
    const idRich = rRich.body.data.id;
    roleIds.add(idRich);
    await post(`/api/admin/roles/${idRich}/grants`, { permissionId: permIds["reports.view"] }, ckOwnerNow);
    const mapCount = async (uid) => Number((await q(`SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1::uuid`, [uid]))[0].n);
    const asAudBefore = Number((await q(`SELECT count(*)::int AS n FROM audit_logs
      WHERE action = 'users.role_assign' AND entity_id = $1::uuid`, [idTu]))[0].n);
    const c6 = await post(`/api/admin/users/${idTu}/roles`, { roleId: idRich }, ckOp);
    t("c6-assign-outside-403", c6.status === 403, String(c6.status));
    t("c6-zero-mutation", (await q(`SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1::uuid AND role_id = $2::uuid`, [idTu, idRich]))[0].n === 0);
    t("c6-zero-audit", Number((await q(`SELECT count(*)::int AS n FROM audit_logs
      WHERE action = 'users.role_assign' AND entity_id = $1::uuid`, [idTu]))[0].n) === asAudBefore);
    const rMeek = await post(`/api/admin/roles`, { name: `BA11G_MEEK_${stamp}`.toUpperCase() }, ckOwnerNow);
    const idMeek = rMeek.body.data.id;
    roleIds.add(idMeek);
    await post(`/api/admin/roles/${idMeek}/grants`, { permissionId: permIds["users.view"] }, ckOwnerNow);
    const c7 = await post(`/api/admin/users/${idTu}/roles`, { roleId: idMeek }, ckOp);
    t("c7-assign-subset-201", c7.status === 201, String(c7.status));
    const c8 = await post(`/api/admin/users/${idTu}/roles`, { roleId: idRich }, ckOwnerNow);
    t("c8-owner-assign-rich-201", c8.status === 201, String(c8.status));
    t("c8-mappings", (await mapCount(idTu)) === 3, String(await mapCount(idTu)));
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      for (const uid of userIds) {
        await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]).catch(() => {});
        await db.query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      }
      for (const rid of roleIds) {
        await db.query(`DELETE FROM role_permissions WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM user_roles WHERE role_id = $1`, [rid]).catch(() => {});
        await db.query(`DELETE FROM roles WHERE id = $1`, [rid]).catch(() => {});
      }
      for (const email of [OWNER_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RBAC_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  done(1);
});
