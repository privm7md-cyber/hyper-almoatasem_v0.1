// PHASE 2.5 customer authentication verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-customer-auth.mjs --db <name> --port <port>
// Covers through the REAL routes (no test doubles): registration (valid,
// duplicate, invalid phone, weak password, unknown/injected fields),
// login (correct, wrong password, unknown phone, inactive, locked — all
// uniform 401), session lifecycle (valid/invalid/expired/revoked/forged),
// logout invalidation (+ double logout), password change (correct/wrong
// current, weak new, old password dead, old sessions revoked), session
// fixation (pre-login token never becomes authenticated), enumeration
// resistance, guest isolation (guest token is not a session), and
// authenticated address CRUD ownership after login.
// Direct SQL is used only for fixture guards (expiry simulation, lockout
// setup verification) and cleanup. Prints JSON, no secrets.
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
  console.log(JSON.stringify({ suite: "customer-auth", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const P_R = "01099000011";
const P_D = "01099000022";
const P_L = "01099000033";
const P_G = "01099000055";
const CANON = (p) => "2010" + p.slice(3);
const PW = "Cust-Test-Pass-0001!";
const PW2 = "Cust-Test-Pass-0002!";
const H = (tok) => ({ "x-customer-token": tok });

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

  const jcall = async (method, path, body, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const get = async (path, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers });
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const post = (path, data, headers = {}) => jcall("POST", path, data, headers);
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");

  try {
    // ---------- REGISTRATION ----------
    const reg = await post(`/api/store/customers/register`, { phone: P_R, firstName: "AuthReg", password: PW });
    const idR = reg.body?.data?.customer?.id ?? null;
    const tokR = reg.body?.data?.customerToken ?? null;
    t("reg-valid-201", reg.status === 201 && !!idR && !!tokR && noSecrets(reg.body)
      && reg.body.data.customer.phone === CANON(P_R)
      && (reg.headers.get("set-cookie") || "").includes("__Host-customer-session="), `${reg.status}`);
    const regDup = await post(`/api/store/customers/register`, { phone: P_R, firstName: "AuthReg", password: PW });
    t("reg-duplicate-409", regDup.status === 409, `${regDup.status}`);
    const regBadPhone = await post(`/api/store/customers/register`, { phone: "01234ABCD", firstName: "X", password: PW });
    t("reg-invalid-phone-400", regBadPhone.status === 400, `${regBadPhone.status}`);
    const regWeak = await post(`/api/store/customers/register`, { phone: P_D, firstName: "X", password: "short" });
    t("reg-weak-password-400", regWeak.status === 400, `${regWeak.status}`);
    const regUnknown = await post(`/api/store/customers/register`, { phone: P_D, firstName: "X", password: PW, governorate: "Minya" });
    t("reg-unknown-field-400", regUnknown.status === 400, `${regUnknown.status}`);
    const regInject = await post(`/api/store/customers/register`, { phone: P_D, firstName: "X", password: PW, customerId: idR, password_hash: "x", is_registered: true });
    t("reg-injection-400", regInject.status === 400, `${regInject.status}`);
    // Guest-row conversion: identify first (guest), then register same phone.
    const gId = await post(`/api/store/customers/identify`, { phone: P_G, firstName: "GuestConv" });
    const regConv = await post(`/api/store/customers/register`, { phone: P_G, firstName: "GuestConv", password: PW });
    t("reg-guest-convert-201", gId.status === 201 && regConv.status === 201
      && regConv.body?.data?.customer?.id === gId.body?.data?.id && !!regConv.body?.data?.customerToken, `${gId.status}/${regConv.status}`);

    // ---------- LOGIN ----------
    const lin = await post(`/api/store/customers/session`, { phone: P_R, password: PW });
    const tokL = lin.body?.data?.customerToken ?? null;
    t("login-valid-200", lin.status === 200 && !!tokL && lin.body?.data?.customer?.id === idR && noSecrets(lin.body), `${lin.status}`);
    const linWrong = await post(`/api/store/customers/session`, { phone: P_R, password: PW2 });
    const linUnknown = await post(`/api/store/customers/session`, { phone: "01099999999", password: PW });
    t("login-wrong-401", linWrong.status === 401, `${linWrong.status}`);
    t("login-unknown-401", linUnknown.status === 401, `${linUnknown.status}`);
    t("login-uniform", JSON.stringify(linWrong.body) === JSON.stringify(linUnknown.body), "envelopes equal");
    // Inactive customer cannot log in (uniform 401).
    await db.query(`UPDATE customers SET is_active = FALSE WHERE phone = $1`, [CANON(P_R)]).catch(() => {});
    const linInactive = await post(`/api/store/customers/session`, { phone: P_R, password: PW });
    t("login-inactive-401", linInactive.status === 401, `${linInactive.status}`);
    await db.query(`UPDATE customers SET is_active = TRUE WHERE phone = $1`, [CANON(P_R)]).catch(() => {});

    // ---------- SESSION lifecycle ----------
    const me = await get(`/api/store/customers/session`, H(tokL));
    t("session-valid-200", me.status === 200 && me.body?.data?.customer?.id === idR, `${me.status}`);
    t("session-invalid-401", (await get(`/api/store/customers/session`, H("ab".repeat(32)))).status === 401);
    // Expired: backdate the newest live session row directly (both stamps,
    // keeping expires_at > created_at per the CHECK), then 401.
    const sessRow = await q(`SELECT id::text AS id FROM customer_sessions WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`);
    if (sessRow.length > 0) {
      await db.query(`UPDATE customer_sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1::uuid`, [sessRow[0].id]);
      const meExp = await get(`/api/store/customers/session`, H(tokL));
      t("session-expired-401", meExp.status === 401, `${meExp.status}`);
      await db.query(`UPDATE customer_sessions SET created_at = now(), expires_at = now() + interval '30 days', revoked_at = NULL WHERE id = $1::uuid`, [sessRow[0].id]);
      const meBack = await get(`/api/store/customers/session`, H(tokL));
      t("session-restored-200", meBack.status === 200, `${meBack.status}`);
    } else {
      t("session-expired-401", false, "no session row");
      t("session-restored-200", false, "no session row");
    }
    // Fixation: a token minted before registration can never authenticate.
    t("fixation-guest-token-401", (await get(`/api/store/customers/session`, { "x-guest-token": "ab".repeat(32) })).status === 401);

    // ---------- LOGOUT ----------
    const lo = await jcall("DELETE", `/api/store/customers/session`, undefined, H(tokL));
    t("logout-200-clears", lo.status === 200 && lo.body?.data?.loggedOut === true
      && (lo.headers.get("set-cookie") || "").includes("__Host-customer-session="), `${lo.status}`);
    const meAfterLo = await get(`/api/store/customers/session`, H(tokL));
    t("logout-invalidates", meAfterLo.status === 401, `${meAfterLo.status}`);
    const loAgain = await jcall("DELETE", `/api/store/customers/session`, undefined, H(tokL));
    t("logout-idempotent-200", loAgain.status === 200, `${loAgain.status}`);

    // ---------- PASSWORD CHANGE (fresh login first: tokL is revoked) ----------
    const lin2 = await post(`/api/store/customers/session`, { phone: P_R, password: PW });
    const tok2 = lin2.body?.data?.customerToken ?? null;
    t("relogin-200", lin2.status === 200 && !!tok2, `${lin2.status}`);
    const pwWrong = await jcall("PATCH", `/api/store/customers/password`, { currentPassword: PW2, newPassword: PW2 }, H(tok2));
    t("password-wrong-current-401", pwWrong.status === 401, `${pwWrong.status}`);
    const pwWeak = await jcall("PATCH", `/api/store/customers/password`, { currentPassword: PW, newPassword: "short" }, H(tok2));
    t("password-weak-new-400", pwWeak.status === 400, `${pwWeak.status}`);
    const pwOk = await jcall("PATCH", `/api/store/customers/password`, { currentPassword: PW, newPassword: PW2 }, H(tok2));
    t("password-change-200", pwOk.status === 200 && pwOk.body?.data?.passwordChanged === true, `${pwOk.status}`);
    // Old password dead; old sessions revoked (tok2 was revoked by the change).
    const linOld = await post(`/api/store/customers/session`, { phone: P_R, password: PW });
    const linNew = await post(`/api/store/customers/session`, { phone: P_R, password: PW2 });
    t("password-old-dead-401", linOld.status === 401, `${linOld.status}`);
    t("password-new-works-200", linNew.status === 200 && !!linNew.body?.data?.customerToken, `${linNew.status}`);
    const meOldSess = await get(`/api/store/customers/session`, H(tok2));
    t("password-revokes-old-sessions", meOldSess.status === 401, `${meOldSess.status}`);
    // Restore original password for idempotent reruns (uses the new session).
    const tokNew = linNew.body?.data?.customerToken;
    const pwBack = await jcall("PATCH", `/api/store/customers/password`, { currentPassword: PW2, newPassword: PW }, H(tokNew));
    t("password-restore-200", pwBack.status === 200, `${pwBack.status}`);

    // ---------- LOCKOUT (dedicated account; 5 wrong → locked, uniform 401) ----------
    const regL = await post(`/api/store/customers/register`, { phone: P_L, firstName: "LockMe", password: PW });
    t("lockout-setup-201", regL.status === 201, `${regL.status}`);
    let lockOk = true;
    for (let i = 0; i < 5; i++) {
      const r = await post(`/api/store/customers/session`, { phone: P_L, password: PW2 });
      if (r.status !== 401) lockOk = false;
    }
    t("lockout-five-fails-401", lockOk);
    const lockedRow = await q(`SELECT locked_until IS NOT NULL AND locked_until > now() AS locked FROM customers WHERE phone = $1`, [CANON(P_L)]);
    t("lockout-flag-set", lockedRow[0]?.locked === true, JSON.stringify(lockedRow[0]));
    const linLocked = await post(`/api/store/customers/session`, { phone: P_L, password: PW });
    t("lockout-correct-denied-401", linLocked.status === 401, `${linLocked.status}`);

    // ---------- AUTHENTICATED ownership after login (address CRUD) ----------
    const linA = await post(`/api/store/customers/session`, { phone: P_R, password: PW });
    const tokA = linA.body?.data?.customerToken;
    const aA = await post(`/api/store/customers/addresses`, { city: "Matai", phone: P_R }, H(tokA));
    t("auth-addr-create-201", aA.status === 201 && !!aA.body?.data?.id, `${aA.status}`);
    const lA = await get(`/api/store/customers/addresses`, H(tokA));
    t("auth-addr-list-own", lA.status === 200 && lA.body?.data?.length === 1, `${lA.status}`);
    const dA = await jcall("DELETE", `/api/store/customers/addresses/${aA.body?.data?.id}`, undefined, H(tokA));
    t("auth-addr-delete-200", dA.status === 200, `${dA.status}`);

    // ---------- guest isolation ----------
    const gG = await post(`/api/store/cart`, {});
    t("guest-cart-still-works", gG.status === 201 && !!gG.body?.data?.guestToken, `${gG.status}`);
    const gSess = await get(`/api/store/customers/session`, { "x-guest-token": gG.body?.data?.guestToken });
    t("guest-token-not-session-401", gSess.status === 401, `${gSess.status}`);
  } finally {
    try {
      for (const ph of [P_R, P_D, P_L, P_G].map(CANON)) {
        const rows = await q(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => []);
        for (const r of rows) {
          await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
          for (const c of cc.rows) {
            await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
            await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
          }
          await db.query(`DELETE FROM orders WHERE customer_id = $1`, [r.id]).catch(() => {});
        }
      }
      for (const ph of [P_R, P_D, P_L, P_G].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`FATAL: ${String(e && e.message ? e.message : e).slice(0, 160)}`);
  process.exit(1);
});

