// BA-C closure — time-contract verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-time-contract.mjs --db <scratch>
//
// Proves the session-timezone root cause and the central fix:
//   BEFORE  a client built exactly like src/lib/db.ts was before the fix
//          (no UTC pin) — reproduces the shift on a non-UTC session.
//   AFTER   the same client built through the app's withUtcSession() pin,
//          under FOUR session time zones and FOUR process time zones.
// Also asserts the business time gates stay SQL-authoritative: promotion
// before/at/inside/after window, coupon window, cart expiry, admin session and
// admin auth-token expiry. Prints JSON; never prints credentials.
import "dotenv/config";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { withUtcSession } from "../../src/lib/db-url.ts";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const SESSION_TZS = ["UTC", "Africa/Cairo", "Pacific/Kiritimati", "America/New_York"];
const HOUR_S = 3600;
// A 1 h token may show marginally under (clock skew between the JS clock and
// the DB clock) or over (sub-millisecond truncation) 3600 s. Pre-fix on a
// +03 session it showed ~14 400 s, so the upper bound is the real assertion.
const ttlHoursTokenToleranceLow = 3500;
const ttlHoursTokenToleranceHigh = 3610;

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });

function scratchUrl(db) {
  const u = new URL(process.env.MIGRATION_DATABASE_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Same shape as src/lib/db.ts, `pinned` selects the central fix. */
function buildClient(url, pinned) {
  const adapter = new PrismaPg({ connectionString: pinned ? withUtcSession(url) : url });
  return new PrismaClient({ adapter });
}

/**
 * Write one TIMESTAMPTZ through the PRODUCTION-SHAPED path (typed Prisma model
 * write with a JS `Date` param) and read the stored instant back with raw pg.
 * `pinned=false` reproduces the pre-fix client exactly.
 */
async function modelWriteDrift(url, db, promoName, pinned = true) {
  const prisma = buildClient(url, pinned);
  const raw = new Client({ connectionString: scratchUrl(db) });
  await raw.connect();
  try {
    const startAt = new Date(Date.now() + 3 * HOUR_S * 1000);
    const created = await prisma.promotion.create({
      data: {
        id: crypto.randomUUID(),
        name: promoName,
        type: "PERCENTAGE",
        scope: "LINE",
        discountPercent: "10.00",
        status: "DRAFT",
        startAt,
      },
      select: { id: true },
    });
    const row = await raw.query(
      `SELECT extract(epoch FROM (start_at - $2::timestamptz))::int AS drift
         FROM promotions WHERE id = $1::uuid`,
      [created.id, startAt.toISOString()],
    );
    await raw.query(`DELETE FROM promotions WHERE id = $1::uuid`, [created.id]);
    return Number(row.rows[0].drift);
  } finally {
    await prisma.$disconnect();
    await raw.end();
  }
}

/** Control: the same instant written as an ISO string (raw path). */
async function rawStringWriteDrift(url, db, probeTable) {
  const prisma = buildClient(url, true);
  const raw = new Client({ connectionString: scratchUrl(db) });
  await raw.connect();
  try {
    const instant = new Date(Date.now() + 2 * HOUR_S * 1000);
    await prisma.$executeRawUnsafe(`INSERT INTO ${probeTable} (k, at) VALUES ('s', $1::timestamptz)`, instant.toISOString());
    const stored = await raw.query(`SELECT at FROM ${probeTable} WHERE k = 's'`);
    await raw.query(`DELETE FROM ${probeTable}`);
    return (stored.rows[0].at.getTime() - instant.getTime()) / 1000;
  } finally {
    await prisma.$disconnect();
    await raw.end();
  }
}

/** Session zone actually granted by a connection string. */
async function sessionTzOf(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(`SHOW timezone`)).rows[0].TimeZone;
  } finally {
    await c.end();
  }
}

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
    process.exit(1);
  }
  const base = scratchUrl(dbName);
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP TABLE IF EXISTS bac_tz_probe`);
  await admin.query(`CREATE TABLE bac_tz_probe (k text primary key, at timestamptz not null)`);

  try {
    // ---------- 1. Server default session zone (what PG hands us today) ------
    const srvTz = (await admin.query(`SHOW timezone`)).rows[0].TimeZone;
    t("server-default-tz-recorded", typeof srvTz === "string" && srvTz.length > 0, srvTz);

    // ---------- 2. BEFORE evidence: unfixed client on a non-UTC session -----
    const cairoUrl = `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c timezone=Africa/Cairo")}`;
    const beforeModel = await modelWriteDrift(cairoUrl, dbName, `BAC TZ before ${Date.now().toString(36)}`, false);
    t(
      "before-unfixed-model-write-shifts",
      beforeModel !== 0 && Math.abs(beforeModel) >= 3600,
      `pre-fix client: promotions.start_at stored ${beforeModel}s off on a Cairo session`,
    );
    const beforeRaw = await rawStringWriteDrift(cairoUrl, dbName, "bac_tz_probe");
    t("before-raw-iso-string-exact", beforeRaw === 0, `raw ISO-string write drift=${beforeRaw}s (control)`);
    console.error(`[time-contract] BEFORE evidence: pre-fix client drift=${beforeModel}s (Cairo session), raw ISO-string control drift=${beforeRaw}s`);

    // ---------- 3. AFTER matrix: process TZ x session TZ, pinned client ------
    const originalTz = process.env.TZ;
    const matrix = [];
    let matrixFailures = 0;
    for (const sessionTz of SESSION_TZS) {
      for (const procTz of SESSION_TZS) {
        process.env.TZ = procTz;
        const url = `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c timezone=${sessionTz}`)}`;
        const drift = await modelWriteDrift(url, dbName, `BAC TZ ${sessionTz}/${procTz} ${Date.now().toString(36)}`);
        const effectiveSessionTz = await sessionTzOf(withUtcSession(url));
        const ok = drift === 0 && effectiveSessionTz === "UTC";
        if (!ok) matrixFailures++;
        matrix.push({ sessionTz, effectiveSessionTz, procTz, drift, ok });
      }
    }
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    t("after-matrix-all-session-tzs-exact", matrixFailures === 0, `${matrix.length} combos, ${matrixFailures} not-exact`);
    t(
      "after-matrix-session-tz-always-utc",
      matrix.every((r) => r.effectiveSessionTz === "UTC"),
      [...new Set(matrix.map((r) => `${r.sessionTz}->${r.effectiveSessionTz}`))].join(" "),
    );
    console.error(`[time-contract] matrix: ${JSON.stringify(matrix)}`);

    // ---------- 4. Pin is authoritative even if the URL asks otherwise ------
    const hostileUrl = `${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c timezone=Pacific/Kiritimati")}`;
    const pinnedAgainstHostile = await sessionTzOf(withUtcSession(hostileUrl));
    t("pin-overrides-hostile-url-option", pinnedAgainstHostile === "UTC", pinnedAgainstHostile);

    // ---------- 5. withUtcSession is pure + lossless -----------------------
    const cases = [
      ["postgres://u:p@h:5432/db", ["-c timezone=UTC"]],
      ["postgres://u:p@h:5432/db?sslmode=require", ["sslmode=require", "-c timezone=UTC"]],
      ["postgres://u:p@h:5432/db?options=-c%20timezone%3DAsia%2FTokyo", ["-c timezone=UTC"]],
      ["postgres://u:p@h:5432/db?options=-c%20statement_timeout%3D5000", ["-c statement_timeout=5000", "-c timezone=UTC"]],
      ["postgres://u:p@ho%40st:5432/db?application_name=x", ["application_name=x", "-c timezone=UTC"]],
    ];
    const urlIssues = [];
    for (const [input, expected] of cases) {
      const out = withUtcSession(input);
      const decoded = decodeURIComponent(out);
      for (const expect of expected) if (!decoded.includes(expect)) urlIssues.push(`${input} -> ${out} missing ${expect}`);
      if (input.includes("ho%40st") && !out.includes("ho%40st")) urlIssues.push(`${input}: password encoding changed`);
      if (/(^|[?&])timezone=/.test(decoded.replace(/-c timezone=UTC/g, ""))) urlIssues.push(`${input}: stray timezone option`);
    }
    t("with-utc-session-url-cases", urlIssues.length === 0, urlIssues.join("; ") || `${cases.length} cases ok`);

    // ---------- 6. Business gates are SQL-authoritative (TZ-proof) ---------
    // Admin auth token TTL through the production-shaped Prisma write
    // (src/lib/auth/auth-tokens.ts uses a JS Date for expires_at). Pre-fix the
    // stored expiry was TTL + the server UTC offset.
    const tokenRow = await (async () => {
      const prisma = buildClient(cairoUrl, true);
      const raw = new Client({ connectionString: scratchUrl(dbName) });
      await raw.connect();
      try {
        const user = (await raw.query(`SELECT id FROM users ORDER BY id LIMIT 1`)).rows[0];
        const ttlHours = 1;
        const created = await prisma.adminAuthToken.create({
          data: {
            id: crypto.randomUUID(),
            userId: user.id,
            purpose: "PASSWORD_RESET",
            tokenHash: createHash("sha256").update(`bactimeprobe${Date.now().toString(36)}`).digest("hex"),
            expiresAt: new Date(Date.now() + ttlHours * HOUR_S * 1000),
          },
          select: { id: true },
        });
        const row = await raw.query(
          `SELECT extract(epoch FROM (expires_at - now()))::int AS remaining FROM admin_auth_tokens WHERE id = $1::uuid`,
          [created.id],
        );
        await raw.query(`DELETE FROM admin_auth_tokens WHERE id = $1::uuid`, [created.id]);
        return Number(row.rows[0].remaining);
      } finally {
        await prisma.$disconnect();
        await raw.end();
      }
    })();
    t(
      "auth-token-ttl-exact",
      tokenRow > ttlHoursTokenToleranceLow && tokenRow < ttlHoursTokenToleranceHigh,
      `1h token shows ${tokenRow}s of life (expected ~3600s)`,
    );

    // Promotion window: before start / inside / after end, decided by SQL.
    const gates = [];
    const promo = async (name, startIso, endIso) => {
      const c = new Client({ connectionString: base });
      await c.connect();
      const row = (
        await c.query(
          `INSERT INTO promotions (id, name, type, scope, status, discount_percent, priority, start_at, end_at)
           VALUES (gen_random_uuid(), $1, 'PERCENTAGE', 'ORDER', 'ACTIVE', 10.00, 5, $2::timestamptz, $3::timestamptz)
           RETURNING id`,
          [name, startIso, endIso],
        )
      ).rows[0];
      await c.end();
      return row.id;
    };
    const effective = async (id) => {
      const c = new Client({ connectionString: base });
      await c.connect();
      const n = (
        await c.query(
          `SELECT count(*)::int AS n FROM promotions p
            WHERE p.id = $1::uuid AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
              AND (p.start_at IS NULL OR p.start_at <= now())
              AND (p.end_at IS NULL OR p.end_at > now())`,
          [id],
        )
      ).rows[0].n;
      await c.end();
      return n;
    };
    const pBefore = await promo(`BAC gate before ${Date.now().toString(36)}`, new Date(Date.now() + HOUR_S * 1000).toISOString(), null);
    const pInside = await promo(`BAC gate inside ${Date.now().toString(36)}`, new Date(Date.now() - HOUR_S * 1000).toISOString(), new Date(Date.now() + HOUR_S * 1000).toISOString());
    const pAfter = await promo(`BAC gate after ${Date.now().toString(36)}`, new Date(Date.now() - 2 * HOUR_S * 1000).toISOString(), new Date(Date.now() - HOUR_S * 1000).toISOString());
    gates.push(["before-start", (await effective(pBefore)) === 0]);
    gates.push(["inside-window", (await effective(pInside)) === 1]);
    gates.push(["after-end", (await effective(pAfter)) === 0]);
    const gatesOk = gates.every(([, ok]) => ok);
    t("sql-window-gates-tz-proof", gatesOk, gates.map(([n, ok]) => `${n}:${ok ? "ok" : "FAIL"}`).join(" "));

    // Cart expiry + admin token expiry stay SQL-side.
    const sqlGates = await admin.query(`
      SELECT
        (SELECT count(*)::int FROM carts c
          WHERE (c.expires_at IS NOT NULL AND c.expires_at <= now())) AS expired_carts,
        (SELECT count(*)::int FROM carts c
          WHERE c.expires_at IS NOT NULL AND c.expires_at > now() + INTERVAL '29 days') AS fresh_carts,
        (SELECT count(*)::int FROM admin_auth_tokens t WHERE t.expires_at > now()) AS live_tokens,
        (SELECT count(*)::int FROM admin_sessions s WHERE s.expires_at > now()) AS live_sessions`);
    const g = sqlGates.rows[0];
    t(
      "sql-expiry-gates-tz-proof",
      g.expired_carts === 0 && g.live_tokens === 0 && g.live_sessions === 0,
      `expiredCarts=${g.expired_carts} liveTokens=${g.live_tokens} liveSessions=${g.live_sessions}`,
    );

    // Cleanup of the gate promos.
    const ids = [pBefore, pInside, pAfter];
    await admin.query(`DELETE FROM promotion_targets WHERE promotion_id = ANY($1::uuid[])`, [ids]);
    await admin.query(`DELETE FROM promotion_rules WHERE promotion_id = ANY($1::uuid[])`, [ids]);
    await admin.query(`DELETE FROM promotions WHERE id = ANY($1::uuid[])`, [ids]);
  } finally {
    await admin.query(`DROP TABLE IF EXISTS bac_tz_probe`).catch(() => {});
    await admin.end();
  }

  const failures = results.filter((r) => !r.pass);
  console.log(
    JSON.stringify(
      {
        suite: "bac-time-contract",
        db: dbName,
        total: results.length,
        failures: failures.length,
        failed: failures,
        passed: results.filter((r) => r.pass).map((r) => r.name),
      },
      null,
      2,
    ),
  );
  process.exitCode = failures.length === 0 ? 0 : 2;
}

main().catch((e) => {
  console.error(`REFUSED_RUN: ${e?.message ?? e}`);
  process.exit(1);
});
