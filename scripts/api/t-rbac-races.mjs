// Final-RBAC race matrix (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-rbac-races.mjs --db <name> --port <port>
// Decisions verified: A role-row serialization (assign vs deactivation),
// B per-request snapshot (revoke/deactivate observed next-request),
// C no implicit auto-join (fresh roles carry zero grants),
// D self-ungrant (ordinary self-removal legal; SUPER_ADMIN bypass impossible).
// R1 assign-wins · R2 deactivation-wins (post-lock recheck 409) ·
// R3 repeated race (no stale success) · R4 grant race · R5 revoke race ·
// R6 role-deactivation race · R7 SUPER_ADMIN safety re-runs ·
// R8 mixed contention (no deadlock, consistent final state).
// Audit invariants: success == 1 mutation + 1 audit; reject == zero/zero;
// losers leave no phantom rows. Prints JSON, never secrets.
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
  console.log(JSON.stringify({ suite: "rbac-races", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");
  const mappingExists = async (uid, rid) => (await q(`SELECT count(*)::int AS n FROM user_roles
    WHERE user_id = $1::uuid AND role_id = $2::uuid`, [uid, rid]))[0].n === 1;
  const roleActive = async (rid) => (await q(`SELECT is_active FROM roles WHERE id = $1::uuid`, [rid]))[0].is_active === true;
  const auditN = async (action, entityId) => Number((await q(`SELECT count(*)::int AS n FROM audit_logs
    WHERE action = $1 AND entity_id = $2::uuid`, [action, entityId]))[0].n);
  const mkUser = async (tag, cko) => {
    const u = await post(`/api/admin/users`, { name: `BA11R ${tag}`, email: `ba11r-${tag}-${stamp}@example.com` }, cko);
    if (u.status !== 201 || !u.body.data?.id) throw new Error(`mkUser ${tag} failed: ${u.status}`);
    userIds.add(u.body.data.id);
    return u.body.data.id;
  };
  const mkRole = async (tag, cko) => {
    const r = await post(`/api/admin/roles`, { name: `BA11R_${tag}_${stamp}`.toUpperCase() }, cko);
    if (r.status !== 201 || !r.body.data?.id) throw new Error(`mkRole ${tag} failed: ${r.status}`);
    roleIds.add(r.body.data.id);
    return r.body.data.id;
  };
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("logins-owner-ok", owner.status === 201 && !!owner.cookie, String(owner.status));
    if (owner.status !== 201 || !owner.cookie) {
      console.error(`REFUSED_LOGIN: owner=${owner.status} (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const cko = owner.cookie;
    const permId = async (k) => (await q(`SELECT id::text AS id FROM permissions WHERE key = $1`, [k]))[0].id;
    const pidReports = await permId("reports.view");
    const pidUsersView = await permId("users.view");
    const pidRolesManage = await permId("roles.manage");

    // ---------- R1: assign wins (assign commits, then deactivation) ----------
    const idR1U = await mkUser("r1u", cko);
    const idR1R = await mkRole("R1", cko);
    const r1a = await post(`/api/admin/users/${idR1U}/roles`, { roleId: idR1R }, cko);
    const r1d = await patch(`/api/admin/roles/${idR1R}`, { isActive: false }, cko);
    t("r1-assign-201", r1a.status === 201, String(r1a.status));
    t("r1-deactivate-200", r1d.status === 200, String(r1d.status));
    t("r1-final", (await mappingExists(idR1U, idR1R)) && !(await roleActive(idR1R)));
    t("r1-audits", (await auditN("users.role_assign", idR1U)) === 1 && (await auditN("roles.update", idR1R)) === 1);

    // ---------- R2: deactivation wins (post-lock recheck rejects) ----------
    const idR2U = await mkUser("r2u", cko);
    const idR2R = await mkRole("R2", cko);
    const r2d = await patch(`/api/admin/roles/${idR2R}`, { isActive: false }, cko);
    const audR2Before = await auditN("users.role_assign", idR2U);
    const r2a = await post(`/api/admin/users/${idR2U}/roles`, { roleId: idR2R }, cko);
    t("r2-deactivate-200", r2d.status === 200, String(r2d.status));
    t("r2-assign-409", r2a.status === 409, String(r2a.status));
    t("r2-zero-mutation", !(await mappingExists(idR2U, idR2R)));
    t("r2-zero-audit", (await auditN("users.role_assign", idR2U)) === audR2Before);

    // ---------- R3: repeated race, no stale success ----------
    for (let i = 0; i < 6; i++) {
      const uid = await mkUser(`r3u${i}`, cko);
      const rid = await mkRole(`R3${i}`, cko);
      const audBefore = await auditN("users.role_assign", uid);
      const [a, d] = await Promise.all([
        post(`/api/admin/users/${uid}/roles`, { roleId: rid }, cko),
        patch(`/api/admin/roles/${rid}`, { isActive: false }, cko),
      ]);
      const pair = [a.status, d.status].sort().join(",");
      const won = a.status === 201;
      const consistent = (won && (await mappingExists(uid, rid))) || (!won && !(await mappingExists(uid, rid)));
      const auditsOk = (await auditN("users.role_assign", uid)) === audBefore + (won ? 1 : 0);
      t(`r3-round${i}`, (pair === "200,201" || pair === "200,409") && d.status === 200 && consistent && auditsOk,
        `${a.status}/${d.status}`);
    }

    // ---------- R4: grant race (duplicates converge, no escalation) ----------
    const idR4R = await mkRole("R4", cko);
    const audR4Before = await auditN("roles.grant", idR4R);
    const [g1, g2] = await Promise.all([
      post(`/api/admin/roles/${idR4R}/grants`, { permissionId: pidReports }, cko),
      post(`/api/admin/roles/${idR4R}/grants`, { permissionId: pidReports }, cko),
    ]);
    t("r4-pair", [g1.status, g2.status].sort().join(",") === "201,409", `${g1.status}/${g2.status}`);
    t("r4-single-row", (await q(`SELECT count(*)::int AS n FROM role_permissions
      WHERE role_id = $1::uuid AND permission_id = $2::uuid`, [idR4R, pidReports]))[0].n === 1);
    t("r4-single-audit", (await auditN("roles.grant", idR4R)) === audR4Before + 1);

    // ---------- R5: revoke race — per-request snapshot ----------
    const idQQ = await mkRole("QQ", cko);
    for (const k of ["roles.manage", "reports.view"]) {
      await post(`/api/admin/roles/${idQQ}/grants`, { permissionId: k === "roles.manage" ? pidRolesManage : pidReports }, cko);
    }
    const idQU = await mkUser("r5qu", cko);
    await post(`/api/admin/users/${idQU}/password`, { password: "Ba11r-Qu-Pass-0001!" }, cko);
    await post(`/api/admin/users/${idQU}/roles`, { roleId: idQQ }, cko);
    const ckQU = (await loginAs(`ba11r-r5qu-${stamp}@example.com`, "Ba11r-Qu-Pass-0001!")).cookie;
    t("r5-qu-login", !!ckQU);
    const idRT = await mkRole("RT", cko);
    const r5pre = await post(`/api/admin/roles/${idRT}/grants`, { permissionId: pidReports }, ckQU);
    t("r5-pre-201", r5pre.status === 201, String(r5pre.status));
    await del(`/api/admin/roles/${idQQ}/grants/${pidReports}`, cko);
    const r5post = await post(`/api/admin/roles/${idRT}/grants`, { permissionId: pidUsersView }, ckQU);
    t("r5-next-sees-revoke-403", r5post.status === 403, String(r5post.status));
    await post(`/api/admin/roles/${idQQ}/grants`, { permissionId: pidReports }, cko);
    const idRTS = await mkRole("RTS", cko);
    const r5re = await post(`/api/admin/roles/${idRTS}/grants`, { permissionId: pidReports }, ckQU);
    t("r5-restore-201", r5re.status === 201, String(r5re.status));
    let ok201 = 0;
    let okConsistent = true;
    for (let i = 0; i < 6; i++) {
      const rid = await mkRole(`R5T${i}`, cko);
      const [ga, rv] = await Promise.all([
        post(`/api/admin/roles/${rid}/grants`, { permissionId: pidReports }, ckQU),
        del(`/api/admin/roles/${idQQ}/grants/${pidReports}`, cko),
      ]);
      if (![201, 403].includes(ga.status) || ![200, 404].includes(rv.status) || ga.status >= 500) okConsistent = false;
      if (ga.status === 201) {
        ok201++;
        const hasRow = (await q(`SELECT count(*)::int AS n FROM role_permissions
          WHERE role_id = $1::uuid AND permission_id = $2::uuid`, [rid, pidReports]))[0].n === 1;
        const hasAudit = (await auditN("roles.grant", rid)) === 1;
        if (!hasRow || !hasAudit) okConsistent = false;
      } else {
        const noRow = (await q(`SELECT count(*)::int AS n FROM role_permissions
          WHERE role_id = $1::uuid AND permission_id = $2::uuid`, [rid, pidReports]))[0].n === 0;
        const noAudit = (await auditN("roles.grant", rid)) === 0;
        if (!noRow || !noAudit) okConsistent = false;
      }
      await post(`/api/admin/roles/${idQQ}/grants`, { permissionId: pidReports }, cko).catch(() => {});
    }
    t("r5-race-consistent", okConsistent, `granted=${ok201}/6`);
    const idRTF = await mkRole("RTF", cko);
    const r5final = await post(`/api/admin/roles/${idRTF}/grants`, { permissionId: pidReports }, ckQU);
    t("r5-settled-201", r5final.status === 201, String(r5final.status));

    // ---------- R6: role-deactivation race ----------
    const idR6P = await mkRole("R6P", cko);
    const r6pre = await post(`/api/admin/roles/${idR6P}/grants`, { permissionId: pidReports }, ckQU);
    t("r6-pre-201", r6pre.status === 201, String(r6pre.status));
    await patch(`/api/admin/roles/${idQQ}`, { isActive: false }, cko);
    const idR6O = await mkRole("R6O", cko);
    const r6off = await post(`/api/admin/roles/${idR6O}/grants`, { permissionId: pidReports }, ckQU);
    t("r6-next-sees-deact-403", r6off.status === 403, String(r6off.status));
    await patch(`/api/admin/roles/${idQQ}`, { isActive: true }, cko);
    const idR6N = await mkRole("R6N", cko);
    const r6on = await post(`/api/admin/roles/${idR6N}/grants`, { permissionId: pidReports }, ckQU);
    t("r6-reactivate-201", r6on.status === 201, String(r6on.status));
    let r6ok = true;
    for (let i = 0; i < 4; i++) {
      const rid = await mkRole(`R6T${i}`, cko);
      const [ga, da] = await Promise.all([
        post(`/api/admin/roles/${rid}/grants`, { permissionId: pidReports }, ckQU),
        patch(`/api/admin/roles/${idQQ}`, { isActive: false }, cko),
      ]);
      if (![201, 403].includes(ga.status) || da.status !== 200 || ga.status >= 500) r6ok = false;
      if (ga.status === 201) {
        if ((await auditN("roles.grant", rid)) !== 1) r6ok = false;
      } else if ((await auditN("roles.grant", rid)) !== 0) r6ok = false;
      await patch(`/api/admin/roles/${idQQ}`, { isActive: true }, cko);
    }
    t("r6-race-consistent", r6ok);

    // ---------- R7: SUPER_ADMIN safety re-runs ----------
    const idS1 = await mkUser("r7a", cko);
    await post(`/api/admin/users/${idS1}/password`, { password: "Ba11r-R7-Pass-0001!" }, cko);
    await post(`/api/admin/users/${idS1}/roles`, { roleId: SUPER_ADMIN_ID }, cko);
    const ckS1 = (await loginAs(`ba11r-r7a-${stamp}@example.com`, "Ba11r-R7-Pass-0001!")).cookie;
    const [s1, s2] = await Promise.all([
      patch(`/api/admin/users/${idS1}`, { isActive: false }, ckS1),
      patch(`/api/admin/users/${idS1}`, { isActive: false }, ckS1),
    ]);
    t("r7-self-race-403", s1.status === 403 && s2.status === 403, `${s1.status}/${s2.status}`);
    t("r7-self-intact", (await q(`SELECT is_active FROM users WHERE id = $1::uuid`, [idS1]))[0].is_active === true);
    const idS2 = await mkUser("r7b", cko);
    await post(`/api/admin/users/${idS2}/password`, { password: "Ba11r-R7-Pass-0002!" }, cko);
    await post(`/api/admin/users/${idS2}/roles`, { roleId: SUPER_ADMIN_ID }, cko);
    const ckS2 = (await loginAs(`ba11r-r7b-${stamp}@example.com`, "Ba11r-R7-Pass-0002!")).cookie;
    // Isolate to exactly two holders (owner mapping removed first — both
    // cross-deactivations may otherwise legitimately succeed).
    const idOwner7 = (await q(`SELECT id::text AS id FROM users WHERE email = $1`, [OWNER_EMAIL]))[0].id;
    await del(`/api/admin/users/${idOwner7}/roles/${SUPER_ADMIN_ID}`, cko);
    const audR7Before = Number((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'users.update'
      AND entity_id = ANY($1::uuid[]) AND new_values->>'isActive' = 'false'`, [[idS1, idS2]]))[0].n);
    const [h1, h2] = await Promise.all([
      patch(`/api/admin/users/${idS2}`, { isActive: false }, ckS1),
      patch(`/api/admin/users/${idS1}`, { isActive: false }, ckS2),
    ]);
    t("r7-holder-race", [h1.status, h2.status].sort().join(",") === "200,409", `${h1.status}/${h2.status}`);
    const holders7 = (await q(`SELECT count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id WHERE r.name = 'SUPER_ADMIN' AND u.is_active AND u.deleted_at IS NULL
      AND r.is_active AND r.deleted_at IS NULL`))[0].n;
    t("r7-never-zero", holders7 === 1, String(holders7));
    t("r7-single-audit", Number((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'users.update'
      AND entity_id = ANY($1::uuid[]) AND new_values->>'isActive' = 'false'`, [[idS1, idS2]]))[0].n) === audR7Before + 1);
    const surv7 = (await q(`SELECT id::text AS id FROM users WHERE id = ANY($1::uuid[]) AND is_active`, [[idS1, idS2]]))[0].id;
    const loser7 = surv7 === idS1 ? idS2 : idS1;
    const ckSurv7 = surv7 === idS1 ? ckS1 : ckS2;
    await patch(`/api/admin/users/${loser7}`, { isActive: true }, ckSurv7);
    await post(`/api/admin/users/${idOwner7}/roles`, { roleId: SUPER_ADMIN_ID }, ckSurv7);
    const [v1, v2] = await Promise.all([
      del(`/api/admin/roles/${SUPER_ADMIN_ID}/grants/${pidReports}`, cko),
      del(`/api/admin/roles/${SUPER_ADMIN_ID}/grants/${pidUsersView}`, cko),
    ]);
    t("r7-revoke-race-403", v1.status === 403 && v2.status === 403, `${v1.status}/${v2.status}`);

    // ---------- R8: mixed contention, no deadlock, consistent state ----------
    const idMU = await mkUser("r8u", cko);
    const idMR = await mkRole("R8", cko);
    await post(`/api/admin/roles/${idMR}/grants`, { permissionId: pidUsersView }, cko);
    const audR8 = {
      assign: await auditN("users.role_assign", idMU),
      updRole: await auditN("roles.update", idMR),
      updUser: await auditN("users.update", idMU),
      grant: await auditN("roles.grant", idMR),
      revoke: await auditN("roles.revoke", idMR),
    };
    const [mAssign1, mAssign2, mDeactR, mGrant, mRevoke, mDeactU] = await Promise.all([
      post(`/api/admin/users/${idMU}/roles`, { roleId: idMR }, cko),
      post(`/api/admin/users/${idMU}/roles`, { roleId: idMR }, cko),
      patch(`/api/admin/roles/${idMR}`, { isActive: false }, cko),
      post(`/api/admin/roles/${idMR}/grants`, { permissionId: pidReports }, cko),
      del(`/api/admin/roles/${idMR}/grants/${pidUsersView}`, cko),
      patch(`/api/admin/users/${idMU}`, { isActive: false }, cko),
    ]);
    const statuses8 = [mAssign1.status, mAssign2.status, mDeactR.status, mGrant.status, mRevoke.status, mDeactU.status];
    t("r8-no-500", statuses8.every((s) => s < 500), statuses8.join(","));
    t("r8-assign-pair", [mAssign1.status, mAssign2.status].sort().join(",") === "201,409"
      || [mAssign1.status, mAssign2.status].sort().join(",") === "409,409", `${mAssign1.status}/${mAssign2.status}`);
    const assignWon = mAssign1.status === 201 || mAssign2.status === 201;
    t("r8-consistent", (await mappingExists(idMU, idMR)) === assignWon
      && !(await roleActive(idMR)) && (await auditN("users.role_assign", idMU)) === audR8.assign + (assignWon ? 1 : 0));
    t("r8-audits", (await auditN("roles.update", idMR)) === audR8.updRole + 1
      && (await auditN("users.update", idMU)) === audR8.updUser + 1
      && (await auditN("roles.grant", idMR)) === audR8.grant + (mGrant.status === 201 ? 1 : 0)
      && (await auditN("roles.revoke", idMR)) === audR8.revoke + (mRevoke.status === 200 ? 1 : 0));
    t("r8-expected", mDeactR.status === 200 && mDeactU.status === 200 && mGrant.status === 201 && mRevoke.status === 200,
      `${mDeactR.status}/${mDeactU.status}/${mGrant.status}/${mRevoke.status}`);

    // ---------- D: self-ungrant / mapping / zero-join ----------
    const idDOp = await mkUser("r8dop", cko);
    const idDOr = await mkRole("DOP", cko);
    await post(`/api/admin/roles/${idDOr}/grants`, { permissionId: pidRolesManage }, cko);
    await post(`/api/admin/roles/${idDOr}/grants`, { permissionId: pidUsersView }, cko);
    await post(`/api/admin/users/${idDOp}/password`, { password: "Ba11r-Dop-Pass-0001!" }, cko);
    await post(`/api/admin/users/${idDOp}/roles`, { roleId: idDOr }, cko);
    const ckDOp = (await loginAs(`ba11r-r8dop-${stamp}@example.com`, "Ba11r-Dop-Pass-0001!")).cookie;
    const d1 = await del(`/api/admin/roles/${idDOr}/grants/${pidUsersView}`, ckDOp);
    t("d1-self-ungrant-200", d1.status === 200, String(d1.status));
    const d1next = await post(`/api/admin/roles/${idDOr}/grants`, { permissionId: pidUsersView }, ckDOp);
    t("d1-next-sees-loss-403", d1next.status === 403, String(d1next.status));
    t("d1-state-intact", (await q(`SELECT is_active FROM users WHERE id = $1::uuid`, [idDOp]))[0].is_active === true
      && (await roleActive(idDOr)));
    const holdersD = (await q(`SELECT u.id::text AS id FROM users u JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id WHERE r.name = 'SUPER_ADMIN' AND u.is_active AND u.deleted_at IS NULL
      AND r.is_active AND r.deleted_at IS NULL`)).map((r) => r.id);
    const idSolo = await mkUser("r8solo", cko);
    await post(`/api/admin/users/${idSolo}/password`, { password: "Ba11r-Solo-Pass-0001!" }, cko);
    await post(`/api/admin/users/${idSolo}/roles`, { roleId: SUPER_ADMIN_ID }, cko);
    const ckSolo = (await loginAs(`ba11r-r8solo-${stamp}@example.com`, "Ba11r-Solo-Pass-0001!")).cookie;
    t("d2-solo-login", !!ckSolo);
    // Fixture safety: the isolation below kills the owner cookie until
    // restore. If solo login failed (rate window), SKIP isolation entirely
    // — never leave the fixture owner roleless.
    const idOwnerRow = (await q(`SELECT id::text AS id FROM users WHERE email = $1`, [OWNER_EMAIL]))[0].id;
    if (ckSolo) {
      // Remove other holders first, owner's mapping LAST (cko dies with the
      // owner's mapping — after that only ckSolo authorizes until restore).
      for (const h of holdersD) {
        if (h !== idSolo && h !== idOwnerRow) await del(`/api/admin/users/${h}/roles/${SUPER_ADMIN_ID}`, cko);
      }
      if (holdersD.includes(idOwnerRow)) await del(`/api/admin/users/${idOwnerRow}/roles/${SUPER_ADMIN_ID}`, cko);
    }
    const oneHolder = (await q(`SELECT count(*)::int AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id WHERE r.name = 'SUPER_ADMIN' AND u.is_active AND u.deleted_at IS NULL
      AND r.is_active AND r.deleted_at IS NULL`))[0].n;
    t("d2-single-holder", oneHolder === 1, String(oneHolder));
    if (ckSolo) {
      const d2 = await del(`/api/admin/users/${idSolo}/roles/${SUPER_ADMIN_ID}`, ckSolo);
      t("d2-self-unmap-last-409", d2.status === 409, String(d2.status));
      t("d2-still-holder", (await q(`SELECT count(*)::int AS n FROM user_roles WHERE user_id = $1::uuid AND role_id = $2::uuid`,
        [idSolo, SUPER_ADMIN_ID]))[0].n === 1);
      // Restore via the solo holder's cookie (solo kept roles.manage; the
      // owner cookie died with the owner's mapping and revives afterwards).
      for (const h of holdersD) {
        if (h !== idSolo) await post(`/api/admin/users/${h}/roles`, { roleId: SUPER_ADMIN_ID }, ckSolo);
      }
    } else {
      t("d2-self-unmap-last-409", false, "skipped: solo login failed");
      t("d2-still-holder", true, "skipped: isolation not entered");
    }
    // Belt-and-braces fixture repair (scratch-only): the owner mapping must
    // exist regardless of which path above ran.
    await db.query(`INSERT INTO user_roles (id, user_id, role_id, assigned_by)
      SELECT gen_random_uuid(), $1::uuid, $2::uuid, NULL WHERE NOT EXISTS
      (SELECT 1 FROM user_roles WHERE user_id = $1::uuid AND role_id = $2::uuid)`,
    [idOwnerRow, SUPER_ADMIN_ID]).catch(() => {});
    const ckOwnerBack = (await loginAs(OWNER_EMAIL, OWNER_PW)).cookie;
    t("d2-owner-back", !!ckOwnerBack);

    // ---------- C: fresh roles carry zero grants (no auto-join) ----------
    const idCJ = await mkRole("CJ", cko);
    t("c-zero-join", (await q(`SELECT count(*)::int AS n FROM role_permissions WHERE role_id = $1::uuid`, [idCJ]))[0].n === 0);

    // ---------- security matrix ----------
    const anonAssign = await post(`/api/admin/users/${idMU}/roles`, { roleId: idMR });
    t("sec-anon-401", anonAssign.status === 401 && noSecrets(anonAssign.body), String(anonAssign.status));
    const bare = await loginAs("bare-cat-test@example.com", "Cat-Test-Bare-Pass-0003!");
    const bareAssign = await post(`/api/admin/users/${idMU}/roles`, { roleId: idMR }, bare.cookie);
    t("sec-bare-403", bareAssign.status === 403 && noSecrets(bareAssign.body), String(bareAssign.status));
    const missAssign = await post(`/api/admin/users/04800000-0000-7000-8000-000000009999/roles`, { roleId: idMR }, cko);
    t("sec-unknown-user-404", missAssign.status === 404 && noSecrets(missAssign.body), String(missAssign.status));
    const missRole = await post(`/api/admin/users/${idMU}/roles`, { roleId: "04800000-0000-7000-8000-000000009999" }, cko);
    t("sec-unknown-role-404", missRole.status === 404 && noSecrets(missRole.body), String(missRole.status));
    const dupAssign = await post(`/api/admin/users/${idR1U}/roles`, { roleId: idR1R }, cko);
    t("sec-inactive-role-409", dupAssign.status === 409 && noSecrets(dupAssign.body), String(dupAssign.status));
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
      for (const email of [OWNER_EMAIL, "bare-cat-test@example.com"]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`RACES_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  done(1);
});
