// Shared HTTP + SQL test client for auth suites (scratch-only).
// Manual cookie jar (no automatic jar semantics): tests observe exact
// Set-Cookie attributes and send back precise Cookie headers.
import "dotenv/config";
import { Client } from "pg";

export const COOKIE_NAME = "__Host-admin-session";
export const GENERIC_MSG = "البريد الإلكتروني أو كلمة المرور غير صحيحة.";

export function scratchUrl(dbName) {
  const u = new URL(process.env.MIGRATION_DATABASE_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export async function sql(dbName, text, params = []) {
  const c = new Client({ connectionString: scratchUrl(dbName), connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    return await c.query(text, params);
  } finally {
    await c.end().catch(() => {});
  }
}

export function makeClient(baseUrl) {
  const jar = {};
  const cookieHeader = () =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  async function storeCookies(res) {
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      const m = /^([^=]+)=([^;]*)/.exec(sc);
      if (m && (m[2] === "" || /expires=thu, 01 jan 1970/i.test(sc))) delete jar[m[1]];
    }
    return setCookies;
  }
  return {
    jar,
    async get(path, opts = {}) {
      const res = await fetch(baseUrl + path, {
        redirect: "manual",
        headers: { ...(Object.keys(jar).length > 0 ? { Cookie: cookieHeader() } : {}), ...(opts.headers || {}) },
      });
      const setCookies = await storeCookies(res);
      return { res, setCookies, text: await res.text() };
    },
    async post(path, body, opts = {}) {
      const res = await fetch(baseUrl + path, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          ...(Object.keys(jar).length > 0 ? { Cookie: cookieHeader() } : {}),
          ...(opts.headers || {}),
        },
        body: JSON.stringify(body),
      });
      const setCookies = await storeCookies(res);
      return { res, setCookies, text: await res.text() };
    },
  };
}

/** Reset volatile auth state on scratch between suites (test-harness only). */
export async function resetAuthState(dbName) {
  await sql(dbName, `UPDATE users SET failed_login_attempts = 0, locked_until = NULL`);
  await sql(dbName, `DELETE FROM admin_auth_rate_limits`);
}

/** Read a bootstrap-safe snapshot of session rows for assertions. */
export async function liveSessions(dbName, email) {
  const r = await sql(
    dbName,
    `SELECT s.id, s.revoked_at IS NOT NULL AS revoked, s.expires_at < now() AS expired
       FROM admin_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY s.created_at`,
    [email],
  );
  return r.rows;
}
