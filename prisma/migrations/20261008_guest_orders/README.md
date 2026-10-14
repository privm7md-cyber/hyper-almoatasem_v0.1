# GUEST ORDER MIGRATION — Hyper Al-Moatasem (BG-Guest-Order, LOCKED design)

Additive guest-order migration. Applies ONLY after
`20261006_catalog_media_search` (migration.sql + supplement.sql).

## Dual-artifact layout

* `migration.sql` — Prisma-owned relational structure: `orders.customer_id`
  and `coupon_usages.customer_id` become nullable (existing rows unaffected —
  every customer order keeps its customer id), plus two new tables
  (`guest_order_credentials`, `guest_order_rate_limits`) with PKs, plain
  UNIQUEs/indexes and FK (`RESTRICT`/`CASCADE` mirroring the frozen
  conventions). Raw guest tokens are never persisted (hash-only).
* `supplement.sql` — SQL-owned integrity: history-actor CHECK amendment
  (`GUEST` + NULL id; SYSTEM/CUSTOMER/STAFF semantics unchanged),
  replacement-decider CHECK amendment (`GUEST` + NULL id on decided rows;
  same approved class — implementation-found, documented in-file), 3 CHECKs
  (deliberately no `expires_at > created_at` — past expiry is a legitimate
  terminal state gated by `expires_at > now()` in lookups), partial UNIQUE
  (exactly one LIVE credential per order; revoked rows stay, so rotation is
  legal), and trigger reuse of the frozen `set_updated_at()` for the
  rate-limit table. No new functions.

## Rules

* Additive only: no frozen object is altered except the single flagged
  history-actor CHECK widening (BGGO-D005, architecture-approved) and the
  two nullability relaxations; no business table is otherwise touched.
* Application order on a scratch database: official baseline migration.sql,
  official baseline supplement.sql, admin-auth migration.sql, admin-auth
  supplement.sql, customer-auth migration.sql + supplement.sql,
  catalog-media-search migration.sql + supplement.sql, then this
  migration.sql, then this supplement.sql.
* Never against production without explicit approval. No secrets here.
* Runtime grants (least privilege, mirroring the session-table counterparts
  — `SELECT, INSERT, UPDATE` on guest_order_credentials; `SELECT, INSERT,
  UPDATE, DELETE` on guest_order_rate_limits) are environment configuration
  applied AS the database/table owner — see `scripts/staging-app-grants.sql`
  (same statements, owner context). Tables stay migrator-owned.
* Mirrors the customer-session credential model (256-bit opaque tokens,
  SHA-256 hash storage, fixed expiry, revocation flags, DB rate buckets)
  for per-order guest access — one credential per order, header transport,
  keep-same on idempotent replay.
