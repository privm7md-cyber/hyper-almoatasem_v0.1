-- CUSTOMER AUTH FOUNDATION migration (Prisma-owned relational structure).
-- Applies AFTER 20260923_admin_auth_foundation (migration.sql + supplement.sql).
-- Prisma-owned only: tables, columns, types, nullability, defaults, PKs, plain
-- UNIQUEs/indexes (frozen-style names via Prisma `map:`), FKs with exact
-- actions, `inet` column shell. Everything Prisma cannot own (CHECKs, partial
-- indexes, trigger reuse) lives in supplement.sql in this directory.
-- No secrets. No business data. Additive only: alters no frozen object except
-- two additive nullable/defaulted columns on customers (existing rows
-- unaffected — password_hash/is_registered already exist from the frozen
-- Phase-2 customer model; registration/login build on them, they are NOT
-- redefined here).

-- ============================ customers (additive lockout columns) ============
-- Mirrors users.failed_login_attempts/locked_until (admin auth): brute-force
-- lockout state for phone+password login. Existing rows unaffected.
ALTER TABLE "customers" ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
                        ADD COLUMN "locked_until" TIMESTAMPTZ(6);

-- ============================ customer_sessions =============================
-- DB-backed opaque customer sessions: only token HASHES stored (SHA-256 hex,
-- 64 chars). Mirrors admin_sessions (same lifecycle: fixed expiry, revocation
-- by flag, last_seen_at touch). Enables real logout, password-change
-- invalidation, and account-disable response — the Phase-2 stateless HMAC
-- token it replaces could do none of these.
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_ip" inet,
    "user_agent" VARCHAR(500),

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- ============================ customer_auth_rate_limits =====================
-- Serverless-safe customer login rate-limit buckets (opaque keys,
-- TTL-pruned by app). Separate table from admin_auth_rate_limits: admin and
-- customer authentication must never share accounting (isolation boundary).
CREATE TABLE "customer_auth_rate_limits" (
    "bucket_key" VARCHAR(128) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_auth_rate_limits_pkey" PRIMARY KEY ("bucket_key", "window_start")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_customer_sessions_customer" ON "customer_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "idx_customer_sessions_expiry" ON "customer_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
