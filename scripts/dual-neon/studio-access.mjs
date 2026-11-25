import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const scryptOptions = { N: 2 ** 17, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const cookieName = "__Host-studio-owner";
const sessionSeconds = 8 * 60 * 60;
const tokenDigest = (token) => createHash("sha256").update(token).digest("hex");
const passwordLength = (password) => typeof password === "string" ? Buffer.byteLength(password) : 0;

export async function hashOwnerPassword(password) {
  if (passwordLength(password) < 15 || passwordLength(password) > 128) {
    throw new Error("Owner password must be 15–128 UTF-8 bytes");
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt, 32, scryptOptions);
  return salt.toString("hex") + "." + key.toString("hex");
}

async function verifyPassword(password, hash) {
  const valid = /^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(hash ?? "");
  const [salt, key] = valid ? hash.split(".") : ["0".repeat(32), "0".repeat(64)];
  const computed = await derive(password, Buffer.from(salt, "hex"), 32, scryptOptions);
  return timingSafeEqual(computed, Buffer.from(key, "hex")) && valid;
}

function sameOrigin(request, origin) {
  const parsed = new URL(origin);
  return parsed.protocol === "https:" && parsed.origin === origin && request.headers.get("origin") === origin;
}

function cook(token, age) {
  return cookieName + "=" + token + "; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + age;
}

function readToken(request) {
  const values = (request.headers.get("cookie") ?? "").split(";").map((value) => value.trim())
    .filter((value) => value.startsWith(cookieName + "="));
  if (values.length !== 1) return null;
  const token = values[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

async function loginWindow(db, scope, allowed) {
  const { rows } = await db.query(`
    INSERT INTO studio_access.login_windows AS login_window (scope, bucket, attempts)
    VALUES ($1, floor(extract(epoch FROM clock_timestamp()) / 900), 1)
    ON CONFLICT (scope, bucket) DO UPDATE SET attempts = login_window.attempts + 1
    WHERE login_window.attempts < $2 RETURNING attempts`, [scope, allowed]);
  return rows.length === 1;
}

export function ownerAccess({ db, origin, limitKey }) {
  if (!Buffer.isBuffer(limitKey) || limitKey.length < 32 || new URL(origin).origin !== origin ||
      !origin.startsWith("https://")) throw new Error("Owner access requires an HTTPS origin and a rate-limit key");
  const response = (status, data, cookie) => Response.json(data, {
    status, headers: { "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) },
  });
  // Derive this bucket from verified hosting infrastructure. Do not trust a
  // client-supplied address header when wiring the login route.
  async function login(request, clientBucket) {
    if (request.method !== "POST" || !sameOrigin(request, origin)) return response(403, { ok: false });
    if (!request.body || request.headers.get("content-type") !== "application/json") return response(400, { ok: false });
    if (typeof clientBucket !== "string" || clientBucket.length < 1 || clientBucket.length > 128) {
      return response(503, { ok: false });
    }
    const reader = request.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return response(413, { ok: false });
        }
        chunks.push(value);
      }
    } catch {
      return response(400, { ok: false });
    } finally {
      reader.releaseLock();
    }
    let password;
    try {
      password = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.password;
    } catch {
      return response(400, { ok: false });
    }
    if (passwordLength(password) < 1 || passwordLength(password) > 128) return response(400, { ok: false });
    const scope = createHmac("sha256", limitKey).update(clientBucket).digest("hex");
    if (!await loginWindow(db, scope, 5) || !await loginWindow(db, "all", 30)) {
      return response(429, { ok: false });
    }
    const { rows: [owner] } = await db.query("SELECT id, password_hash FROM studio_access.owner WHERE singleton AND enabled");
    if (!await verifyPassword(password, owner?.password_hash) || !owner) return response(401, { ok: false });
    const token = randomBytes(32).toString("base64url");
    // Recheck the configured hash at insertion to avoid creating a session during credential rotation.
    const { rows } = await db.query(`
      INSERT INTO studio_access.sessions (token_digest, owner_id, expires_at)
      SELECT $1, id, now() + make_interval(secs => $2)
      FROM studio_access.owner WHERE id = $3 AND enabled AND password_hash = $4
      RETURNING owner_id`, [tokenDigest(token), sessionSeconds, owner.id, owner.password_hash]);
    if (!rows.length) return response(401, { ok: false });
    return response(200, { ok: true }, cook(token, sessionSeconds));
  }

  async function authorize(request) {
    if (!["HEAD", "GET"].includes(request.method) && !sameOrigin(request, origin)) return null;
    const token = readToken(request);
    if (!token) return null;
    const { rows: [session] } = await db.query(`
      SELECT o.id FROM studio_access.sessions s JOIN studio_access.owner o ON o.id = s.owner_id
      WHERE s.token_digest = $1 AND s.expires_at > now() AND o.enabled`, [tokenDigest(token)]);
    return session ? { ownerId: session.id, role: "OWNER" } : null;
  }

  async function logout(request) {
    if (request.method !== "POST" || !sameOrigin(request, origin)) return response(403, { ok: false });
    const token = readToken(request);
    if (token) await db.query("DELETE FROM studio_access.sessions WHERE token_digest = $1", [tokenDigest(token)]);
    return response(200, { ok: true }, cook("", 0));
  }
  return { login, authorize, logout };
}
