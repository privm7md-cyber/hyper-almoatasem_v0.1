// Expired guest-cart sweeper — MANUAL maintenance runner (BA-A closure).
//
// Moves logically-expired guest carts (status ACTIVE, expires_at elapsed)
// to the frozen terminal state EXPIRED. This is table hygiene + visibility
// only: since BA-A, expired carts are already unresolvable (every operable
// lookup requires ACTIVE AND unexpired), so the flip changes NO API outcome
// (merge/checkout hit the same reject paths for EXPIRED as for
// ACTIVE-but-expired; replay paths key off orders/cart-id, not status).
// Carts never hold inventory reservations, so nothing is released.
// Customer carts (expires_at NULL) are never touched.
//
// Safety contract (frozen-SQL compliant, no schema change):
// - single conditional UPDATE (SQL now() — never a JS clock);
// - ACTIVE -> EXPIRED is a legal frozen transition (trigger-whitelisted);
// - idempotent (re-run matches zero rows) and safe under concurrency
//   (row-local single statement, no app mutex, no lock ordering);
// - DRY-RUN BY DEFAULT; --execute required to write;
// - SCRATCH-ONLY allowlist (never hyper_almoatasem; production use needs a
//   separate explicit authorization and, eventually, a real scheduler —
//   this script claims no scheduling).
//
// Usage:
//   node scripts/maintenance/sweep-expired-carts.mjs --db <scratch> [--execute]
// Prints JSON { db, dryRun, matched, expired }. Exit 0 on success.
import "dotenv/config";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const execute = args.includes("--execute");

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
  "hyper_almoatasem_restore_verify_20260924",
  "hyper_almoatasem_restore_verify_2_20260924",
];

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName} (scratch-only; production never)`);
    process.exit(1);
  }
  const target = new URL(process.env.MIGRATION_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const db = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 8000 });
  await db.connect();
  try {
    if (!execute) {
      const r = await db.query(
        `SELECT count(*)::int AS n FROM carts WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= now()`,
      );
      console.log(JSON.stringify({ db: dbName, dryRun: true, matched: r.rows[0].n, expired: 0 }));
      return;
    }
    const r = await db.query(
      `UPDATE carts SET status = 'EXPIRED'
        WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= now()
        RETURNING id`,
    );
    console.log(JSON.stringify({ db: dbName, dryRun: false, matched: r.rowCount ?? r.rows.length, expired: r.rows.length }));
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`SWEEP_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 160)}`);
  process.exit(1);
});
