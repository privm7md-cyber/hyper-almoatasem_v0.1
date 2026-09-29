# B14 — Neon Hosted PostgreSQL: Provisioning, Restore & Verification Record

> B14 execution record. No secrets in this file — connection strings appear
> only in masked `USER:***@HOST/DATABASE` form. No cutover, no Vercel
> Production change, and no deployment were performed in B14.

## Provider / project

* Provider: Neon PostgreSQL (serverless, AWS-hosted)
* Region: `aws-eu-central-1` (Frankfurt) — nearest EU region to the deployment;
  no MENA region exists; latency not claimed without measurement
* Project: `hyper-almoatasem` (`cold-bread-44980587`), org `org-patient-morning-40742388`
* Branch: `main` (`br-wild-cherry-b14oeoyt`, ready)
* Database: `hyper_almoatasem`
* Target PostgreSQL: **18.6** (source is 18.4; same major — accepted per plan)
* Plan/tier: **Free** — NOT a production SLA (scale-to-zero cannot be disabled,
  6h instant-restore window, no SLA). Production requires a paid upgrade with
  scale-to-zero disabled; that billing decision is human-gated and NOT done.

## Access model (closest safe Neon equivalent)

* Roles: `hyper_owner` (initial project role, admin capability),
  `hyper_migrator`, `hyper_app` (both created via Neon roles API).
* Ownership: 34 business tables → `hyper_owner`; `_prisma_migrations` →
  `hyper_migrator` (transferred via drop + migrator-owned re-restore after a
  direct `OWNER TO` proved impossible without role membership, which was
  refused to preserve the zero-membership model).
* Grants: full explicit-grant catalog reproduced (388 rows, byte-identical),
  including app DML on the six bootstrap tables + history, and owner
  SELECT/INSERT/UPDATE on history (Option A). Default privileges for both
  `hyper_owner` and `hyper_migrator` reproduced exactly.
* Memberships: none (a transient membership grant was attempted and refused
  by Neon; zero-membership model preserved).
* Provider residue (expected, harmless): `cloud_admin` default-privilege
  entries and `neon_superuser` references exist on Neon only; they affect no
  application object.

## Pooled / direct architecture

* Runtime (`DATABASE_URL`):
  `postgresql://hyper_app:***@<pooler-host>/hyper_almoatasem?sslmode=require`
  (Neon PgBouncer transaction pooler; TLS verify-full proven.)
* Migration/admin (`DIRECT_URL`):
  `postgresql://hyper_owner:***@<direct-host>/hyper_almoatasem?sslmode=require`
  (direct; used for migrations, dump/restore, admin verification).
* Never run migrations through the transaction pooler. Never use pooled URLs
  for `pg_dump`/`pg_restore`.

## Fresh source backup (cutover source, NOT the pre-auth dump)

* Source: local `hyper_almoatasem`, PostgreSQL 18.4, taken 2026-09-24 (~18:49 local)
* File: `_recovery/production-current-20260924.dump` (kept; old pre-auth dump kept untouched)
* Format: `pg_dump -Fc`, 146,027 bytes
* SHA-256: `4698A189A1BBBC4B7E99DCA1ACBB6F58633C2E8275FA1D30440C328E2A932CB5`
* Integrity: `pg_restore --list` clean, 307 TOC entries.

## Restore result

* Full restore as owner; exactly 3 non-fatal errors, all in the anticipated
  class (history `OWNER TO` without membership; 2× migrator default-privilege
  entries) — remediated deterministically (history re-restored migrator-owned;
  default privileges applied as migrator; grants applied explicitly).
* No other errors; no superuser-only metadata required.

## Fingerprint result (LOCAL vs NEON)

* Tables 35/35 · columns 353/353 · PKs 35 · FKs 41 (+actions) · uniques 21 ·
  indexes 109/109 incl. predicates · triggers 23 · functions 6 (bodies
  identical) · views 1 (identical) · sequences (names + `order_number_seq`
  state 71/71) · pgcrypto-only extension set · ownership 34:1 identical ·
  history 3 rows identical · counts 2/31/55/8/1/1 + zero business/auth rows
  identical · grants 388 rows identical · memberships identical.
* ONE expected difference: `chk_tokens_purpose` CHECK text renders with
  18.4 vs 18.6 deparser parenthesization (`IN`-list cast placement only) —
  semantically identical predicate, matching the project's documented
  deparser-normalization phenomenon. Zero semantic drift otherwise.
* Prisma `migrate status` on Neon: baseline + auth applied; only the
  never-to-apply prototype pending. `migrate diff` live-vs-schema: ONLY the
  two known `inet` no-op ALTERs. No drift.

## Migration result

* No migration executed on Neon (schema arrived via restore, as designed).
* History preserved exactly; supplement effects present (10 CHECKs + partial
  index + trigger reuse verified in the fingerprint).

## TLS result

* `verify-full` with ISRG Root X1 proven on BOTH pooled (app) and direct
  (owner) paths. No verification weakening at any point.

## Backup rehearsal result

* `pg_dump -Fc` from Neon (direct, owner): 147,178 bytes, `--list` clean
  (309 entries: 307 + 2 Neon-side schema residue entries).
* Trial restore into a disposable local scratch database: complete
  (35 tables, 2/31/55/8/1 bootstrap counts); 5 ignored errors, all in the
  expected provider-residue class (neon_superuser/cloud_admin references,
  migrator default-privilege entries). Rehearsal database dropped afterward;
  rehearsal dump deleted. Source, verified, and Neon databases untouched.

## Vercel preparation (NOT performed — human-gated)

* Required Production variables: `DATABASE_URL` = pooled runtime URL as
  `hyper_app`; `DIRECT_URL` = direct URL for migrations/admin.
* Add them via Vercel's own secret mechanism (dashboard/CLI) by a human —
  never via chat. Target environment must be Production.
* Deploy only immutable `6b6cdfb`; no migration/seed/bootstrap hooks may run
  at build/deploy time (`postinstall` is a proven no-op).

## Known limitations

* Free tier is unsuitable for production (scale-to-zero, 6h PITR, no SLA);
  paid upgrade + region/latency validation remain human decisions.
* Neon auto-applies minor versions (currently 18.6); minors cannot be pinned.
* Neon-generated role credentials appeared in local tooling output during
  provisioning; **rotate all three Neon role passwords via Console after
  review** (no values are recorded anywhere by the agent).
* `cloud_admin`/`neon_superuser` residue entries exist on Neon only.
