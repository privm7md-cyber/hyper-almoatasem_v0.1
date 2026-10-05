# Backend Production Readiness — operational record (BA-H)

> Engineering hardening only. This document changes nothing operationally:
> no migration, no deploy, no production write was performed to produce it.
> Production go-live remains a separate human authorization (see §8).

## 1. Environment boundary

| Environment | Database | Connection | Purpose |
|---|---|---|---|
| Local dev | `hyper_almoatasem` (local PG 18) | `.env` `DATABASE_URL` (app role) | Day-to-day development. NEVER run test suites against it. |
| Scratch | `hyper_almoatasem_scratch` (+ dated variants) | `DATABASE_URL` session-env override | ALL destructive/concurrency/integration tests. Disposable. |
| Preview (Neon) | Neon branch DB | Neon pooled URL | Preview deploys only. |
| Production | `hyper_almoatasem` on Neon `main` | Neon pooled URL (app), direct URL (migrations) | Go-live authorized only. READ-ONLY unless a runbook step says otherwise. |

`.env` points at the LOCAL database, never at Neon production. Any local API
server under test must be started with an explicit scratch `DATABASE_URL`
override; every test runner refuses non-scratch databases fail-closed
(`REFUSED_DB`) and verifies server↔suite DB identity before any login.

## 2. Connection strings

* Runtime (`DATABASE_URL`): Neon **pooled** (PgBouncer transaction pooler)
  endpoint, `sslmode=require`. Pooled is REQUIRED at runtime: serverless
  instances must never hold direct connections open (exhaustion risk).
* Migrations/admin (`DIRECT_URL` or equivalent direct host): direct endpoint.
  Never run migrations, `pg_dump` or `pg_restore` through the pooler.
* Current `prisma.config.ts` uses `DATABASE_URL` for everything; there is no
  pending migration, so nothing to change. When a migration is authorized,
  point the migrator at the direct endpoint for that run only.

## 3. UTC session requirement

Every application database session MUST run with `TimeZone = UTC`. Reason:
Prisma 7.10 serialises JS `Date` parameters without an offset; PostgreSQL
reads offset-less literals in the session time zone, so a non-UTC session
stores every Date-bound TIMESTAMPTZ shifted by the server offset
(DST-varying). Full root-cause record: `src/lib/db-url.ts`.

Enforcement is in code, not in ops runbooks: `withUtcSession()` pins
`options=-c timezone=UTC` on every pooled connection from the single factory
(`src/lib/db.ts`) and overrides any conflicting `options` arriving via the
URL. Verified: 4×4 session×process time-zone matrix exact; PgBouncer tracks
`timezone` per client and re-applies it on activation, so the pin survives
Neon transaction pooling (vendor-documented behavior).

Operational consequences:
* Do NOT set a non-UTC `options=-c timezone=…` on any app connection string;
  the factory strips it (by design — a stray value would silently defeat the
  pin). If a conflicting value is ever genuinely needed: STOP, architecture
  decision first.
* `ALTER ROLE … SET timezone` is NOT required for correctness and is NOT
  applied. It would only protect non-application clients.
* Business clocks stay SQL-side (`now()`); never compare Prisma-decoded
  timestamps in JS.

## 4. Pool sizing (reviewed, deliberately unchanged)

Current: `pg` defaults (max 10 connections per serverless instance, no
explicit timeouts), one pool per instance via the module singleton
(`globalThis` cached in dev; fresh per instance in production).

Math: Neon-tier connection cap ÷ max expected concurrent instances must
stay comfortably above `instances × max`. With defaults (10/instance), ~10
warm instances already approach small-tier caps — which is exactly why the
runtime URL MUST be the Neon **pooled** endpoint (§2): the pooler multiplexes
correctly regardless of per-instance pools.

No code change made: without production load evidence, shrinking `max` risks
queue timeouts under legitimate checkout bursts (one tx holds a connection
for the whole reserve→snapshot→finalize sequence), and raising it risks
exhaustion. Revisit with measured concurrency data, not before. Changing
this file's guidance into code tunables without load evidence would itself
be an arbitrary-number violation of project rules.

## 5. Cold / warm behavior (verified)

* Cold start: fresh `next dev` / built server boots and serves health on the
  first request with no warm-up ritual (observed repeatedly this phase).
* Warm reuse: the singleton pool is reused across requests in-process.
* DB outage: API answers sanitized `500 {"error":{"code":"INTERNAL",
  "message":"Unexpected error.","details":null}}` — no stack, SQL, or
  connection string (proven live by stopping PostgreSQL mid-session).
* Pool recovery: after the database returns, the pool reconnects
  transparently (health 200 on next probe, no restart needed).

No production-scalability claim is made from single-instance observations.

## 6. CI scope (what runs where and why)

`.github/workflows/ci.yml` runs hermetic checks only: `npm ci` (root +
`db/tests`), `tsc --noEmit`, `eslint src scripts --max-warnings 0`,
7 unit suites, 3 PGlite frozen-SQL suites, `node
scripts/api/route-coverage.mjs` (route↔OpenAPI drift gate), `npm run build`
with a dummy `DATABASE_URL` that is never dialed.

Deliberately NOT in CI: the live-API matrix. It needs provisioned fixtures
(products + users with known test passwords) and login-bucket spacing, and
the frozen fail-closed rate limits make back-to-back CI runs flaky by design.
That matrix stays a local scratch gate (proven green repeatedly). No secret
and no production connection exists anywhere in CI.

## 7. Rate limits (operational)

Login: IP 30 + account 10 per 15-minute DB-backed buckets (serverless-safe,
fail-closed generic 401/429). No global API rate limiter exists by design;
do not add one without a business reason and load evidence. Suite runners:
space login-heavy suites across bucket rollovers; a `REFUSED_LOGIN`/`401`
cascade means "wait for the window", never a product defect.

## 8. Go-live is NOT approved by this document

Engineering hardening complete ≠ production go-live approved. Go-live still
needs, each separately authorized: database target confirmation, migration
authorization (none pending — auth foundation already applied 2026-09-24),
verified backup, deployment, domain/TLS, monitoring, and real production
configuration (secrets via environment, never in repo).
