# CUSTOMER AUTH FOUNDATION MIGRATION — Hyper Al-Moatasem (PREPARATION ONLY)

Additive customer-auth migration. Applies ONLY after
`20260923_admin_auth_foundation` (migration.sql + supplement.sql).

## Dual-artifact layout

* `migration.sql` — Prisma-owned relational structure: two additive columns
  on `customers` (`failed_login_attempts`, `locked_until`; existing rows
  unaffected — nullable/defaulted), plus two new tables
  (`customer_sessions`, `customer_auth_rate_limits`) with PKs, plain
  UNIQUEs/indexes and FK (`RESTRICT`/`CASCADE` mirroring the frozen
  conventions). `created_ip` is an `inet` shell (raw-SQL writes, same posture
  as `admin_sessions.created_ip`).
* `supplement.sql` — SQL-owned integrity: 4 CHECKs, 1 partial index
  (`idx_customer_sessions_customer_live`), and trigger reuse of the frozen
  `set_updated_at()` for the rate-limit table. No new functions.

## Rules

* Additive only: no frozen object is altered except the two additive customers
  columns; no business table is touched.
* Application order on a scratch database: official baseline migration.sql,
  official baseline supplement.sql, admin-auth migration.sql, admin-auth
  supplement.sql, then this migration.sql, then this supplement.sql.
* Never against production without explicit approval. No secrets here.
* Runtime grants (least privilege, mirroring the admin counterparts —
  `SELECT, INSERT, UPDATE` on customer_sessions; `SELECT, INSERT, UPDATE,
  DELETE` on customer_auth_rate_limits) are environment configuration
  applied AS the database/table owner — see
  `scripts/staging-app-grants.sql` (same statements, owner context).
  Tables stay migrator-owned.
* Mirrors the admin-auth login model (Argon2id, 5→15min lockout, opaque
  hashed sessions, DB rate buckets) for the customer identity — phone +
  password credentials, HMAC-less server-side sessions.
