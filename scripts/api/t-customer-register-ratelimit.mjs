// G5 registration rate-limit verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-customer-register-ratelimit.mjs --db <name> --port <port>
// Server under test MUST run with REG_RATE_LIMIT_PHONE_SECRET=<TEST_SECRET below>;
// phone bucket keys are HMAC-bound (plain-SHA-256 keys are rejected as evidence).
// Covers through the REAL route (no test doubles): below-limit 201, IP-bucket
// 429 (pre-filled), canonical-phone-bucket 429 across IPs, window recovery,
// login-bucket isolation (+ live login still 200), phone-digest privacy (no
// raw phone in keys/bodies), legitimate repeats, malformed bodies burn no
// budget. Buckets are pre-filled via SQL to threshold edges (no 41-hash
// burn); direct SQL is also used for window-shift recovery and cleanup.
// Prints JSON, no secrets.
import "dotenv/config";
import { Client } from "pg";
import { createHash, createHmac } from "node:crypto";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "customer-register-ratelimit", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => ({ name: f.name, detail: f.detail })), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

// Ladder-valid 010 numbers (11 digits: 010 + 8) in a range no other suite uses.
const P = (n) => `0109981${String(n).padStart(4, "0")}`;
const CANON = (p) => "2010" + p.slice(3);
// Deterministic harness-only test secret (never real; server under test must
// run with this same REG_RATE_LIMIT_PHONE_SECRET — see suite header).
const TEST_SECRET = "9f".repeat(32);
const DIGEST = (canon) => createHmac("sha256", Buffer.from(TEST_SECRET, "hex")).update(canon, "utf8").digest("hex");
const PLAIN = (canon) => createHash("sha256").update(canon, "utf8").digest("hex");
const PW = "RegLimit-Test-Pass-0001!";
const XFF = (ip) => ({ "x-forwarded-for": ip });

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
  const post = (path, data, headers = {}) => jcall("POST", path, data, headers);
  const reg = (phone, first, ip, pw = PW) => post(`/api/store/customers/register`, { phone, firstName: first, password: pw }, XFF(ip));
  const phones = [P(1), P(2), P(3), P(4), P(5), P(6)];
  const win = (await q(`SELECT date_trunc('hour', now()) + (floor(date_part('minute', now()) / 15) * interval '15 minutes') AS w`))[0].w;
  const loginBase = (await q(`SELECT count(*)::int AS n FROM customer_auth_rate_limits WHERE bucket_key LIKE 'login:cust-%'`).catch(() => [{ n: -1 }]))[0]?.n;

  try {
    // ---------- below-limit normal ----------
    const r1 = await reg(P(1), "RlOne", "192.0.2.21");
    t("below-limit-201", r1.status === 201 && r1.body?.data?.customer?.phone === CANON(P(1)), `${r1.status}`);

    // ---------- secret-bound key proof: stored key is HMAC, not plain SHA-256 ----------
    const canon1 = CANON(P(1));
    const stored1 = await q(`SELECT bucket_key FROM customer_auth_rate_limits WHERE bucket_key LIKE 'reg:cust-acct:%'`).catch(() => []);
    const mine = stored1.map((r) => r.bucket_key).find((k) => k === `reg:cust-acct:${DIGEST(canon1)}`);
    t("hmac-bound-live", mine !== undefined, "server key matches HMAC(secret)");
    t("not-plain-sha256", !stored1.some((r) => r.bucket_key === `reg:cust-acct:${PLAIN(canon1)}`), "no fallback");

    // ---------- IP bucket gate (pre-filled to 30) ----------
    await db.query(`INSERT INTO customer_auth_rate_limits (bucket_key, window_start, attempts) VALUES ('reg:cust-ip:192.0.2.22', $1::timestamptz, 30) ON CONFLICT (bucket_key, window_start) DO UPDATE SET attempts = 30`, [win]).catch(() => {});
    const rIp = await reg(P(2), "RlIp", "192.0.2.22");
    t("ip-over-limit-429", rIp.status === 429, `${rIp.status}`);
    t("ip-429-generic", rIp.body?.error?.code === "RATE_LIMITED", JSON.stringify(rIp.body?.error ?? {}).slice(0, 80));

    // ---------- phone bucket gate (pre-filled to 10; different IP proves independence) ----------
    const canon3 = CANON(P(3));
    const dig3 = DIGEST(canon3);
    await db.query(`INSERT INTO customer_auth_rate_limits (bucket_key, window_start, attempts) VALUES ($1, $2::timestamptz, 10) ON CONFLICT (bucket_key, window_start) DO UPDATE SET attempts = 10`, [`reg:cust-acct:${dig3}`, win]).catch(() => {});
    const rPh = await reg(P(3), "RlPhone", "192.0.2.23");
    t("phone-over-limit-429", rPh.status === 429, `${rPh.status}`);

    // ---------- privacy: no raw phone in keys or bodies ----------
    const keys = await q(`SELECT bucket_key FROM customer_auth_rate_limits WHERE bucket_key LIKE 'reg:%'`).catch(() => []);
    const phoneKeys = keys.filter((r) => r.bucket_key.startsWith("reg:cust-acct:"));
    t("phone-keys-digested", phoneKeys.length > 0 && phoneKeys.every((r) => /^[0-9a-f]{64}$/.test(r.bucket_key.slice("reg:cust-acct:".length))), `${phoneKeys.length} keys`);
    t("phone-keys-no-raw", phoneKeys.every((r) => !r.bucket_key.includes("2010") && !r.bucket_key.includes("01099")), "scan");
    const bodies = JSON.stringify([rIp.body, rPh.body]);
    t("bodies-no-digest-leak", !bodies.includes(dig3) && !bodies.includes(canon3), "scan");

    // ---------- window recovery (shift window back; fresh phone on recovered IP) ----------
    await db.query(`UPDATE customer_auth_rate_limits SET window_start = now() - interval '16 minutes' WHERE bucket_key = 'reg:cust-ip:192.0.2.22'`).catch(() => {});
    const rRec = await reg(P(4), "RlRec", "192.0.2.22");
    t("window-recovery-201", rRec.status === 201, `${rRec.status}`);

    // ---------- login-bucket isolation: reg traffic must not touch login counters ----------
    const loginNow = (await q(`SELECT count(*)::int AS n FROM customer_auth_rate_limits WHERE bucket_key LIKE 'login:cust-%'`).catch(() => [{ n: -1 }]))[0]?.n;
    t("login-buckets-untouched-by-reg", loginNow === loginBase, `base=${loginBase} now=${loginNow}`);
    const lin = await post(`/api/store/customers/session`, { phone: P(1), password: PW }, XFF("192.0.2.21"));
    t("login-still-200", lin.status === 200, `${lin.status}`);

    // ---------- legitimate repeated attempts ----------
    const r5 = await reg(P(5), "RlFive", "192.0.2.25");
    const r6 = await reg(P(6), "RlSix", "192.0.2.25");
    t("legit-repeats-201", r5.status === 201 && r6.status === 201, `${r5.status}/${r6.status}`);

    // ---------- malformed body burns no budget ----------
    const rBad = await post(`/api/store/customers/register`, { phone: P(2), firstName: "X" }, XFF("192.0.2.26"));
    const noRow = await q(`SELECT count(*)::int AS n FROM customer_auth_rate_limits WHERE bucket_key LIKE 'reg:%192.0.2.26%'`).catch(() => [{ n: -1 }]);
    t("malformed-400-no-budget", rBad.status === 400 && noRow[0]?.n === 0, `${rBad.status}/${noRow[0]?.n}`);
  } finally {
    try {
      for (const ph of phones.map(CANON)) {
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
      for (const ph of phones.map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      await db.query(`DELETE FROM customer_auth_rate_limits WHERE bucket_key LIKE 'reg:cust-ip:192.0.2.%'`).catch(() => {});
      for (const ph of phones.map(CANON)) {
        await db.query(`DELETE FROM customer_auth_rate_limits WHERE bucket_key = $1`, [`reg:cust-acct:${DIGEST(ph)}`]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => { console.error(`FATAL: ${e?.message ?? e}`); process.exit(1); });
