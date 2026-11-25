-- RESIDUAL PHASE-10 CLOSURE migration (Prisma-owned relational structure).
-- Applies AFTER 20261008_guest_orders (migration.sql + supplement.sql).
-- Two additive tables only; no frozen object is altered:
--   • delivery_zones — explicit per-zone delivery-fee overrides (area/village/
--     city key, admin-managed). orders.delivery_fee remains the historical
--     snapshot; no order row is ever rewritten by a fee change.
--   • guest_checkout_sessions — pre-established HttpOnly guest recovery
--     session (SHA-256 hash only), bound to the cart BEFORE create and to the
--     order inside the create transaction. Recovers a lost 201 without
--     reissuing or exposing the per-order credential.
-- No secrets. No business data.

-- ============================ delivery_zones ===============================
-- normalized_name is the only matching key (lowercase/whitespace/orthographic
-- normalization, applied identically by the admin write path and the fee
-- resolver). name keeps the admin-visible spelling. version is the optimistic
-- concurrency token (timestamps are not safe across JS millisecond precision).
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "normalized_name" VARCHAR(80) NOT NULL,
    "fee" NUMERIC(10, 2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_normalized_name_key" ON "delivery_zones"("normalized_name");

-- CreateIndex
CREATE INDEX "idx_delivery_zones_active" ON "delivery_zones"("is_active");

-- ======================== guest_checkout_sessions ==========================
-- One row per pre-checkout recovery session. Only the SHA-256 hash of the
-- 256-bit opaque token is stored; the raw token lives solely in an HttpOnly
-- cookie. order_id is NULL until the create transaction binds it. Rows are
-- history: revocation sets revoked_at, the app never deletes them.
CREATE TABLE "guest_checkout_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" VARCHAR(128) NOT NULL,
    "cart_id" UUID NOT NULL,
    "order_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_checkout_sessions_token_hash_key" ON "guest_checkout_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_guest_checkout_cart" ON "guest_checkout_sessions"("cart_id");

-- CreateIndex
CREATE INDEX "idx_guest_checkout_order" ON "guest_checkout_sessions"("order_id");

-- CreateIndex
CREATE INDEX "idx_guest_checkout_expiry" ON "guest_checkout_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "guest_checkout_sessions" ADD CONSTRAINT "guest_checkout_sessions_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_checkout_sessions" ADD CONSTRAINT "guest_checkout_sessions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
