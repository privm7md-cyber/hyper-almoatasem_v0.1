// D4 PROOF SUITE â€” the client cannot choose its own rate-limit identity.
//
// Run against a server WITHOUT `TRUSTED_PROXY` and WITHOUT `VERCEL=1`
// (the harness starts this suite's server in that posture â€” see
// SUITE_SERVER_ENV in the isolated runner). That is the DEFAULT posture of
// any deployment that has not declared a trusted proxy, and it is the posture
// that must be safe on its own.
//
// The proof is made against the DATABASE, not against an HTTP status code:
// the limiter stores its bucket keys in PostgreSQL, so the bucket table shows
// exactly which identity each request was accounted to.
//
//   * Forged single IPv4 / IPv6 / multi-value chain / invalid / absent /
//     local / 3-hop chain headers are sent, each with a DIFFERENT value.
//   * If the client could choose its identity, every request would land in
//     its OWN bucket and no limit would ever engage.
//   * The correct behaviour is the opposite: every request is accounted to
//     the single shared UNKNOWN bucket, the limit engages exactly at the
//     documented threshold, and a request with a brand-new forged address
//     afterwards is still limited â€” the header buys the caller nothing.
//
// Two independent limiters are proved (two buckets, two tables):
//   * the guest storefront order READ bucket (60 / 15 min / IP)
//   * the admin login IP bucket (30 / 15 min / IP)
//
// The audit trail is checked too: a forged address must never be recorded as
// an identity (`ip_address IS NULL`).
//
// Usage: node scripts/api/t-proxy-identity.mjs --db <name> --port <port>
import "dotenv/config";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });

const ALLOWED = [
  "hyper_almoatasem_p12full_execution",
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_e2e_20261106",
  "hyper_almoatasem_closure_20261030",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const GUEST_READ_LIMIT = 60;
const LOGIN_IP_LIMIT = 30;

const BASE = `http://127.0.0.1:${port}`;

/**
 * The forged-header variations. Every value is DIFFERENT, so a limiter that
 * trusted the header would produce a distinct bucket per value.
 */
const FORGED = [
  { label: "ipv4-a", value: "203.0.113.1" },
  { label: "ipv4-b", value: "203.0.113.2" },
  { label: "ipv4-c", value: "198.51.100.5" },
  { label: "ipv4-d", value: "192.0.2.44" },
  { label: "ipv4-e", value: "203.0.113.250" },
  { label: "ipv6-a", value: "2001:db8::1" },
  { label: "ipv6-b", value: "2001:db8::dead:beef" },
  { label: "ipv6-full", value: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" },
  { label: "chain-2", value: "203.0.113.9, 198.51.100.7" },
  { label: "chain-3", value: "203.0.113.10, 198.51.100.8, 192.0.2.1" },
  { label: "chain-spaces", value: "203.0.113.11 , 198.51.100.9" },
  { label: "invalid-hostname", value: "not-an-ip.example.com" },
  { label: "invalid-text", value: "definitely-not-an-ip" },
  { label: "invalid-port", value: "203.0.113.12:8080" },
  { label: "local", value: "127.0.0.1" },
  { label: "local-v6", value: "::1" },
  { label: "unspecified", value: "0.0.0.0" },
  { label: "broadcast", value: "255.255.255.255" },
  { label: "absent", value: null },
];

const FORGED_IPS = FORGED.map((f) => f.value).filter((v) => typeof v === "string");

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
    process.exit(1);
  }
  // Scratch-DB discipline (fixed): connect to the TARGET scratch database by
  // swapping only the pathname of MIGRATION_DATABASE_URL — never to the raw
  // env URL (which points at production hyper_almoatasem in this repo).
  const scratchUrl = (() => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  if (!scratchUrl) {
    console.error("MIGRATION_DATABASE_URL missing");
    process.exit(1);
  }
  const db = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 8000 });
  await db.connect();
  const ident = await db.query(
    `SELECT current_database() db, current_user usr, inet_server_addr()::text addr, inet_server_port() port`,
  );
  // stderr: stdout carries the JSON result only, so the runner can parse it.
  console.error(`IDENTITY ${JSON.stringify(ident.rows[0])}`);
  t("db-identity-matches", ident.rows[0].db === dbName, JSON.stringify(ident.rows[0]));

  const bogusOrderId = "04800000-0000-7000-8000-00000000dead";
  const bogusToken = "a".repeat(64);

  const readBucketKeys = async () =>
    (
      await db.query(
        `SELECT bucket_key, attempts FROM guest_order_rate_limits
          WHERE bucket_key LIKE 'guest-order:read-ip:%'
          ORDER BY bucket_key`,
      )
    ).rows;
  const loginBucketKeys = async () =>
    (
      await db.query(
        `SELECT bucket_key, attempts FROM admin_auth_rate_limits
          WHERE bucket_key LIKE 'login:ip:%'
          ORDER BY bucket_key`,
      )
    ).rows;

  // ---------------------------------------------------------------- guest read
  // The read gate is fail-closed and runs BEFORE the credential check, so a
  // bogus order id still consumes the bucket â€” the limiter is what is under
  // test here, not the order lookup.
  //
  // WINDOW ALIGNMENT. The limiter uses fixed 15-minute windows aligned to the
  // clock (`date_trunc('hour', now()) + floor(minute/15)*15min`). A burst that
  // straddles a window boundary is handed a FRESH budget half-way through, so
  // the counter would read fewer attempts than requests and the threshold
  // would never engage. That is a property of the fixed window, not of the
  // identity model under test, so the suite DETECTS the rollover (the bucket
  // no longer matches the request count) and repeats the burst: the rollover
  // has just opened a fresh window, so the repeat fits inside one window. No
  // assertion is relaxed â€” the window alignment is asserted in its own right.
  const measureGuestRead = async () => {
    for (let round = 1; round <= 3; round++) {
      // Start from an empty bucket so `attempts` counts exactly this burst.
      await db.query(`DELETE FROM guest_order_rate_limits WHERE bucket_key LIKE 'guest-order:read-ip:%'`);
      const statuses = [];
      for (let i = 0; i < GUEST_READ_LIMIT + 4; i++) {
        const forged = FORGED[i % FORGED.length];
        const headers = { "x-guest-order-token": bogusToken };
        if (forged.value !== null) headers["x-forwarded-for"] = forged.value;
        const res = await fetch(`${BASE}/api/store/orders/${bogusOrderId}`, { headers });
        statuses.push(res.status);
        await res.text();
      }
      const rows = await readBucketKeys();
      const counted = rows.length === 1 ? Number(rows[0].attempts) : -1;

      // A brand-new forged address after the limit engaged: if the header
      // chose the identity, this request would be unlimited. It must land in
      // the SAME window as the burst, otherwise it would be handed a fresh
      // budget and would prove nothing.
      const freshForged = "203.0.113.222";
      const freshRes = await fetch(`${BASE}/api/store/orders/${bogusOrderId}`, {
        headers: { "x-guest-order-token": bogusToken, "x-forwarded-for": freshForged },
      });
      const freshStatus = freshRes.status;
      await freshRes.text();
      const rowsAfter = await readBucketKeys();
      const countedAfter = rowsAfter.length === 1 ? Number(rowsAfter[0].attempts) : -1;

      const burstAligned = rows.length === 1 && counted === statuses.length;
      const probeAligned = rowsAfter.length === 1 && countedAfter === statuses.length + 1;
      if (burstAligned && probeAligned && freshStatus === 429) {
        return { statuses, rows, rowsAfter, freshStatus, rounds: round };
      }
      console.error(
        `ROUND_RETRY round=${round} burstAligned=${burstAligned} probeAligned=${probeAligned} ` +
          `counted=${counted} countedAfter=${countedAfter} requests=${statuses.length} fresh=${freshStatus}`,
      );
    }
    throw new Error("guest-read burst could not be fitted into one rate-limit window");
  };

  const read = await measureGuestRead();
  const readStatuses = read.statuses;
  const readKeys = read.rows;
  t(
    "guest-read-window-aligned",
    read.rounds >= 1,
    `rounds=${read.rounds} counted=${Number(readKeys[0]?.attempts)} requests=${readStatuses.length}`,
  );
  const beforeLimit = readStatuses.slice(0, GUEST_READ_LIMIT);
  const afterLimit = readStatuses.slice(GUEST_READ_LIMIT);
  t(
    "guest-read-no-429-before-limit",
    beforeLimit.every((s) => s !== 429),
    `statuses=${[...new Set(beforeLimit)].join(",")}`,
  );
  t(
    "guest-read-limit-engages-at-threshold",
    afterLimit.every((s) => s === 429),
    `statuses=${[...new Set(afterLimit)].join(",")}`,
  );
  t(
    "guest-read-no-5xx",
    readStatuses.every((s) => s < 500),
    `statuses=${[...new Set(readStatuses)].join(",")}`,
  );

  t(
    "guest-read-single-bucket",
    readKeys.length === 1,
    `keys=${JSON.stringify(readKeys.map((r) => r.bucket_key))}`,
  );
  t(
    "guest-read-bucket-is-unknown",
    readKeys.length === 1 && readKeys[0].bucket_key === "guest-order:read-ip:unknown",
    `keys=${JSON.stringify(readKeys.map((r) => r.bucket_key))}`,
  );
  t(
    "guest-read-bucket-counts-every-request",
    readKeys.length === 1 && Number(readKeys[0].attempts) === readStatuses.length,
    `attempts=${readKeys[0]?.attempts} requests=${readStatuses.length}`,
  );
  t(
    "guest-read-no-forged-ip-bucket",
    readKeys.every((r) => !FORGED_IPS.some((ip) => r.bucket_key.includes(ip))),
    `keys=${JSON.stringify(readKeys.map((r) => r.bucket_key))}`,
  );

  t(
    "guest-read-fresh-forged-ip-still-limited",
    read.freshStatus === 429,
    `status=${read.freshStatus}`,
  );
  const readKeysAfter = read.rowsAfter;
  t(
    "guest-read-fresh-forged-ip-joined-the-same-bucket",
    readKeysAfter.length === 1 && readKeysAfter[0].bucket_key === "guest-order:read-ip:unknown",
    `keys=${JSON.stringify(readKeysAfter.map((r) => r.bucket_key))}`,
  );

  // ---------------------------------------------------------------- admin login
  // A DIFFERENT account per request, so the per-account bucket never
  // accumulates and only the IP bucket can engage.
  await db.query(`DELETE FROM admin_auth_rate_limits WHERE bucket_key LIKE 'login:ip:%'`);
  // Baseline for the audit scoping-proof (Third Agent 2026-11-07): the shared
  // e2e DB accumulates audit_logs across suites/postures (frozen rule: audit
  // residue is never deleted). Capture server-time BEFORE the burst and scope
  // the final assertion to this run's window. This does NOT weaken the check:
  // it still requires rows from this burst and proves none carry a forged IP.
  const auditWindowStart = (await db.query(`SELECT now() AS t`)).rows[0].t;
  let loginStatuses = [];
  for (let i = 0; i < LOGIN_IP_LIMIT + 4; i++) {
    const forged = FORGED[i % FORGED.length];
    const headers = { "content-type": "application/json" };
    if (forged.value !== null) headers["x-forwarded-for"] = forged.value;
    const res = await fetch(`${BASE}/api/admin/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: `probe-${i}@example.invalid`, password: "Wrong-Password-0001!" }),
    });
    loginStatuses.push(res.status);
    await res.text();
  }
  t(
    "login-no-5xx",
    loginStatuses.every((s) => s < 500),
    `statuses=${[...new Set(loginStatuses)].join(",")}`,
  );
  t(
    "login-never-succeeds-with-forged-identity",
    loginStatuses.every((s) => s !== 200 && s !== 201),
    `statuses=${[...new Set(loginStatuses)].join(",")}`,
  );

  const loginKeys = await loginBucketKeys();
  t(
    "login-single-bucket",
    loginKeys.length === 1,
    `keys=${JSON.stringify(loginKeys.map((r) => r.bucket_key))}`,
  );
  t(
    "login-bucket-is-unknown",
    loginKeys.length === 1 && loginKeys[0].bucket_key === "login:ip:unknown",
    `keys=${JSON.stringify(loginKeys.map((r) => r.bucket_key))}`,
  );
  t(
    "login-no-forged-ip-bucket",
    loginKeys.every((r) => !FORGED_IPS.some((ip) => r.bucket_key.includes(ip))),
    `keys=${JSON.stringify(loginKeys.map((r) => r.bucket_key))}`,
  );

  // The audit trail must not record a forged address as an identity.
  // Scoped to THIS run's window (created_at >= burst start). The whole-table
  // count is reported for transparency but never asserted, because inherited
  // rows from other postures (e.g. TRUSTED_PROXY=1 suites) legitimately carry
  // IPs and would otherwise fail this run spuriously.
  const auditScoped = await db.query(
    `SELECT count(*)::int AS total,
            count(ip_address)::int AS with_ip
       FROM audit_logs
      WHERE action = $1 AND created_at >= $2::timestamptz`,
    ["auth.login_failure", auditWindowStart],
  );
  const auditWhole = await db.query(
    `SELECT count(*)::int AS total,
            count(ip_address)::int AS with_ip
       FROM audit_logs
      WHERE action = $1`,
    ["auth.login_failure"],
  );
  t(
    "audit-login-failure-has-no-client-ip",
    auditScoped.rows[0].total > 0 && auditScoped.rows[0].with_ip === 0,
    `scoped_total=${auditScoped.rows[0].total} scoped_with_ip=${auditScoped.rows[0].with_ip} whole_total=${auditWhole.rows[0].total} whole_with_ip=${auditWhole.rows[0].with_ip} window=${auditWindowStart}`,
  );

  await db.end();

  const failures = results.filter((r) => !r.pass);
  console.log(
    JSON.stringify(
      {
        suite: "proxy-identity",
        db: dbName,
        posture: "no TRUSTED_PROXY, no VERCEL (untrusted default)",
        forgedHeaderVariations: FORGED.map((f) => f.label),
        total: results.length,
        failures: failures.length,
        failed: failures.map((f) => `${f.name} :: ${f.detail}`),
        passed: results.filter((r) => r.pass).map((r) => r.name),
      },
      null,
      2,
    ),
  );
  process.exitCode = failures.length === 0 ? 0 : 2;
}

main().catch((e) => {
  console.error(`FATAL: ${e?.message ?? e}`);
  process.exit(1);
});
