-- GUEST ORDER migration (Prisma-owned relational structure).
-- Applies AFTER 20261006_catalog_media_search (migration.sql + supplement.sql).
-- Implements BGGO-D001/D002/D004/D009 (BG-Guest-Order closure, LOCKED):
-- nullable orders.customer_id + nullable coupon_usages.customer_id (guest rows
-- only; every existing customer order keeps a non-null customer_id), plus two
-- new tables: guest_order_credentials (per-order opaque access token,
-- SHA-256 hash ONLY, fixed expiry, revocation by flag) and
-- guest_order_rate_limits (isolated buckets — guest accounting never shares
-- admin/customer tables). Additive only: no frozen object is otherwise
-- altered (the history-actor CHECK amendment lives in supplement.sql).
-- No secrets. No business data.

-- ============================ orders (guest nullability) ==================
-- True account-less guest orders carry customer_id = NULL; identity and
-- contact live in the order snapshots + the credential row. RESTRICT FK kept.
ALTER TABLE "orders" ALTER COLUMN "customer_id" DROP NOT NULL;

-- ============================ coupon_usages (guest nullability) ============
-- Guest orders consuming non-per-customer coupons record a usage row with
-- NULL customer (per-customer-limited coupons stay 422 for guests).
ALTER TABLE "coupon_usages" ALTER COLUMN "customer_id" DROP NOT NULL;

-- ============================ guest_order_credentials =====================
-- Per-order guest access credential: only token HASHES stored (SHA-256 hex,
-- 64 chars — same posture as customer_sessions/admin_sessions). One row per
-- order (UNIQUE order_id); raw token is returned once at issuance and never
-- persisted. Fixed expiry (no sliding); revocation by flag (rows are
-- history, never deleted by the app).
CREATE TABLE "guest_order_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_order_credentials_pkey" PRIMARY KEY ("id")
);

-- ============================ guest_order_rate_limits =====================
-- Serverless-safe guest order rate-limit buckets (opaque keys, TTL-pruned by
-- app). Separate table: guest accounting never shares admin/customer
-- buckets (isolation boundary). Same shape as customer_auth_rate_limits.
CREATE TABLE "guest_order_rate_limits" (
    "bucket_key" VARCHAR(128) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_order_rate_limits_pkey" PRIMARY KEY ("bucket_key", "window_start")
);

-- CreateIndex (plain: one LIVE credential per order is enforced by the
-- partial UNIQUE in supplement.sql — revoked rows stay as history, so a
-- full UNIQUE would forbid rotation).
CREATE INDEX "guest_order_credentials_order_id_idx" ON "guest_order_credentials"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_order_credentials_token_hash_key" ON "guest_order_credentials"("token_hash");

-- CreateIndex
CREATE INDEX "idx_guest_order_credentials_expiry" ON "guest_order_credentials"("expires_at");

-- AddForeignKey
ALTER TABLE "guest_order_credentials" ADD CONSTRAINT "guest_order_credentials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
