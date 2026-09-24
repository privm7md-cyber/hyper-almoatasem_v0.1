-- ADMIN AUTH FOUNDATION migration (Prisma-owned relational structure).
-- Applies AFTER 20260923_baseline__official (migration.sql + supplement.sql).
-- Prisma-owned only: tables, columns, types, nullability, defaults, PKs, plain
-- UNIQUEs/indexes (frozen-style names via Prisma `map:`), FKs with exact
-- actions, `inet` column shell. Everything Prisma cannot own (CHECKs, partial
-- indexes, trigger reuse) lives in supplement.sql in this directory.
-- No secrets. No business data. Additive only: alters no frozen object except
-- three additive nullable/defaulted columns on users (existing rows unaffected).

-- ============================ users (additive auth columns) =================
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(255),
                    ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN "locked_until" TIMESTAMPTZ(6);

-- ============================ admin_sessions ================================
-- DB-backed opaque sessions: only token HASHES stored (SHA-256 hex, 64 chars).
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_ip" inet,
    "user_agent" VARCHAR(500),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- ============================ admin_auth_tokens =============================
-- One-time tokens (INVITATION | PASSWORD_RESET): hash-only storage.
CREATE TABLE "admin_auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- ============================ admin_auth_rate_limits ========================
-- Serverless-safe login rate-limit buckets (opaque keys, TTL-pruned by app).
CREATE TABLE "admin_auth_rate_limits" (
    "bucket_key" VARCHAR(128) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_auth_rate_limits_pkey" PRIMARY KEY ("bucket_key", "window_start")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_sessions_user" ON "admin_sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_sessions_expiry" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_auth_tokens_token_hash_key" ON "admin_auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_tokens_user" ON "admin_auth_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_auth_tokens" ADD CONSTRAINT "admin_auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
