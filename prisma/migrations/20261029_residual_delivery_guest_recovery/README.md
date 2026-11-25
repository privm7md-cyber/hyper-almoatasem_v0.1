# RESIDUAL PHASE-10 CLOSURE MIGRATION — Hyper Al-Moatasem

Additive migration. Applies ONLY after `20261008_guest_orders`
(`migration.sql` + `supplement.sql`).

## Dual-artifact layout

* `migration.sql` — Prisma-owned relational structure:
  * `delivery_zones` (name, normalized matching key, NUMERIC(10,2) fee,
    active flag, optimistic `version`, timestamps; unique normalized key).
  * `guest_checkout_sessions` (SHA-256 token hash, cart FK, nullable order FK,
    fixed expiry, revocation flag, timestamp; unique hash).
* `supplement.sql` — SQL-owned integrity: non-negative fee, positive version,
  normalized-key shape, hash shape, revocation ordering, and reuse of the
  frozen `set_updated_at()` trigger for `delivery_zones`. No new functions.

## Rules

* Additive only: no frozen table/column/constraint is altered.
* Application order on a scratch database: official baseline + admin-auth +
  customer-auth + catalog-media-search + guest-orders (each `migration.sql`
  then `supplement.sql`), then this `migration.sql`, then this `supplement.sql`.
* Never against production/shared databases without explicit approval.
* Runtime grants (least privilege) are environment configuration applied AS
  the table owner — see `scripts/staging-app-grants.sql`:
  * `delivery_zones`: `SELECT, INSERT, UPDATE` (admin-managed config; zones
    are deactivated rather than deleted so fee/audit history survives).
  * `guest_checkout_sessions`: `SELECT, INSERT, UPDATE` (rows are history; no
    hard delete — revocation by flag).
  * Tables stay migrator-owned.
* The per-order credential contract is unchanged: 256-bit opaque token,
  SHA-256 hash at rest, 90-day fixed TTL, header transport, keep-same replay.
  The checkout recovery session is a separate 24-hour, cart/order-bound access
  path used only when the one-time 201 credential was never delivered.
* No secrets, no business data.
