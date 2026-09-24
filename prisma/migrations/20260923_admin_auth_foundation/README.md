# ADMIN AUTH FOUNDATION MIGRATION — Hyper Al-Moatasem (PREPARATION ONLY)

Additive auth-foundation migration. Applies ONLY after
`20260923_baseline__official` (migration.sql + supplement.sql).

## Dual-artifact layout

* `migration.sql` — Prisma-owned relational structure: three additive columns
  on `users` (`password_hash`, `failed_login_attempts`, `locked_until`;
  existing rows unaffected — nullable/defaulted), plus three new tables
  (`admin_sessions`, `admin_auth_tokens`, `admin_auth_rate_limits`) with PKs,
  plain UNIQUEs/indexes and FKs (`RESTRICT`/`CASCADE` mirroring the frozen
  conventions). `created_ip` is an `inet` shell (raw-SQL writes, same posture
  as `audit_logs.ip_address`).
* `supplement.sql` — SQL-owned integrity: 10 CHECKs, 1 partial index
  (`idx_sessions_user_live`), and trigger reuse of the frozen `set_updated_at()`
  for the rate-limit table. No new functions.

## Rules

* Additive only: no frozen object is altered except the three additive users
  columns; no business table is touched.
* Application order on a scratch database: official baseline migration.sql,
  official baseline supplement.sql, then this migration.sql, then this
  supplement.sql.
* Never against `hyper_almoatasem` without explicit approval. No secrets here.
