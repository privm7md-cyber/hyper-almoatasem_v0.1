# BA-4 Customers — implementation record

> Backend APIs only. No frontend. No BA-5+. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`, reused from
> the BA-3 build); production untouched (every test connection is
> allowlisted to scratch names only; the Next server under test pointed at
> scratch).

## 1. Customer identity model (frozen)

- **Unified `customers` table** — no Guest/Registered split tables.
  `password_hash NULL` = guest; `is_registered = FALSE OR password_hash
  IS NOT NULL` (DB CHECK); upgrade is a single-row UPDATE (history never
  splits).
- **Phone is the identity**: global `UNIQUE`, canonical digits
  `^[0-9]{8,15}$` at the DB backstop; the app normalizes to `2010XXXXXXXX`
  (R8 ladder) BEFORE write.
- **Guest needs no account/password** — identify creates guests with name
  + phone only. **Registered requires `password_hash`** (frozen CHECK;
  enforced in `upgradeToRegistered`).
- **Email**: optional (`NULL` × N coexist), trimmed + lowercased at the
  boundary (users-table convention), format CHECK + partial UNIQUE in SQL
  (duplicates → 409). Never required.
- Customer login does NOT exist (frozen) — no customer sessions, no OTP;
  customer self-service auth is deferred. `password_hash` never leaves the
  server (omitted from every shape by construction; suites assert absence).

## 2. Phone normalization (R8, single utility)

`src/lib/customers/phone.ts` (pure, unit-tested) implements the exact
frozen ladder from `phase2-architecture-proposal.md` R8 and the
`normalizePhone` reference in `db/tests/run-tests.js`:

```text
strip non-digits → 00-drop → 0→20 (len 11) / prepend-20 (len 10, leading 1)
→ keep (len 12, leading 20) / else REJECT → gate ^201[0125][0-9]{8}$
```

`01012345678`, `+201012345678`, `00201012345678`, `201012345678` converge
to `201012345678`. Non-EG mobiles (`014…`, `019…`, foreign) reject.
Address contact phones reuse the SAME ladder and fall back to stripped
digits when they satisfy the frozen address CHECK (`^[0-9]{8,15}$`) —
"canonicalize when mobile", landlines pass through (e.g. `02-23456789` →
`0223456789`). Wire failures: empty/blank/non-string → 400 (Zod);
ladder rejections → 422 (business rule).

## 3. Endpoints

Public (guest flow — no customer sessions exist in frozen scope):

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/store/customers/identify` | get-or-create guest by phone (`200` existing / `201` created) |

Admin (session + RBAC):

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/admin/customers` | `customers.view` | list/search (phone/name/email), registered/active filters, cursor pagination |
| GET | `/api/admin/customers/[id]` | `customers.view` | detail + address book |
| PATCH | `/api/admin/customers/[id]` | `customers.view`¹ | name/email/auto-accept/active edits (phone immutable; no delete) |
| POST | `/api/admin/customers/[id]/register` | `customers.view`¹ | staff-assisted guest → registered (policy + Argon2id) |
| GET/POST | `/api/admin/customers/[id]/addresses` | `customers.view`¹ | list (default first) + create (default switch in one tx) |
| GET/PATCH/DELETE | `/api/admin/customers/[id]/addresses/[addressId]` | `customers.view`¹ | scoped get/edit/hard-delete |

¹ Documented closest-capability mapping (BA-2 taxonomy precedent): the
frozen 31-key matrix holds no customer write key, and no key is invented.
Reads use the exact key. A future `customers.manage` split is deferred
(requires an architecture decision + seed-data migration — NOT done here).

## 4. Addresses

- Frozen shape exactly: `label?`, `city*`, `area?`, `village?`, `street?`,
  `building_number?`, `landmark?`, `phone*`, `is_default`. **No
  governorate, no postal/geo fields** — extra keys → 400 (strict objects;
  `address-no-governorate-400`).
- Lengths mirror the VARCHARs; blank-after-trim required fields → 400;
  Arabic payloads first-class (no name/address regex beyond trim+length).
- Ownership: every address route scopes by path `customerId`;
  cross-customer access → 404 (never leaks existence — `address-cross-*-404`).
- Default: at most one per customer (partial UQ, DB-enforced); switch =
  unset-old + set-new in ONE tx; lost race → 409. Hard delete allowed
  (no `deleted_at`; orders keep snapshots, never FKs here).

## 5. Concurrency

- Identify: `SELECT → INSERT → reselect-on-unique-violation`. The UNIQUE
  backstop (not app memory) arbitrates; concurrent creators converge on
  one row. No `ON CONFLICT DO NOTHING` (the row itself is the outcome).
- Upgrade: single conditional `UPDATE … WHERE is_registered = FALSE`
  (raw SQL — Prisma.update cannot express the guard); rowcount 0 → 409.
- No `SERIALIZABLE`, no app mutex. Races proven live: A (same phone →
  `{201,200}`, one id, one row); B (three canonical equivalents → one
  id, one row); C (competing defaults → `{201,409}`, exactly one default).

## 6. Idempotency

No `Idempotency-Key` for BA-4: the frozen contract attaches idempotency
only to order creation (BA-6). Identify is naturally convergent
(same phone → same customer, `created` flag distinguishes); address
writes are staff-operated single intents. Nothing invented.

## 7. Transactions (explicit boundaries, no generic wrapper)

- Identify: intentionally statement-scoped (atomic INSERT + UNIQUE
  convergence — a wrapping tx would add nothing).
- Upgrade: one conditional UPDATE statement.
- Address create/patch with `isDefault: true`: explicit
  `prisma.$transaction` (unset-others + write).
- Single-statement mutations otherwise.

## 8. Prisma vs raw SQL

- Prisma owns everything representable (CRUD, plain UQs, FK, tx blocks,
  P2002 → 409 / P2025 → 404 mapping).
- Raw SQL in exactly one place: `upgradeToRegistered`'s guarded UPDATE
  (rowcount-checked `WHERE is_registered = FALSE`). Reason documented in
  code; everything else stays in Prisma.

## 9. Errors (BA-1 envelopes, no new codes)

400 malformed/strict-unknown/coerced types; 401 anonymous (identify stays
public by guest-flow necessity — documented OTP gap); 403 roleless;
404 unknown ids + cross-customer denial (existence never leaked);
409 email/phone-unique + already-registered + default-race losers;
422 phone-ladder/policy/step-semantic failures; no 429 surface (no
endpoint uses the existing login rate limits).

## 10. Sensitive data

Passwords/hashes/tokens never logged (no customer logger call carries
them), never returned, never stored except as Argon2id (OWASP minimums:
19456 KiB / t=2 / p=1, policy 12..128 via existing
`src/lib/auth/password.ts`). Test hash assertions check the
`$argon2id$` prefix + flag only.

## 11. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-customers-unit.mjs` (ladders + boundaries, no DB) | 40/40 |
| `scripts/api/t-customers.mjs` (HTTP on scratch) | 66/66 |
| `scripts/api/t-customers-concurrency.mjs` (races A–C, real PG) | 8/8 |
| BA-1 `t-foundation.mjs` | 26/26 |
| BA-2 `t-catalog.mjs` (scratch) | 53/53 |
| BA-3 `t-inventory-unit.mjs` | 34/34 |
| BA-3 `t-inventory.mjs` (scratch) | 84/84 |
| BA-3 `t-inventory-concurrency.mjs` | 18/18 |
| CC-1 `t-cc1-lockout.mjs` (scratch) | 8/8 |
| `t-password.mjs` | 9/9 |
| Phase 2 functional | 77/77 |
| Phase 4 functional | 65/65 |
| Phase 5 functional | 50/50 |
| `tsc --noEmit` / ESLint (new files) / `npm run build` | PASS |

Skipped with reason: 240+120 frozen embedded-PG batteries (frozen SQL
byte-identical and untouched; new contended paths covered by races A–C)
and the CC-1 TZ rerun (auth code untouched). One test-authoring digit
miscount fixed in-suite (source never at fault).

## 12. Files

- New: `src/lib/customers/{phone,validation,serialize,queries,writes}.ts`;
  `src/app/api/store/customers/identify/route.ts`;
  `src/app/api/admin/customers/route.ts`;
  `src/app/api/admin/customers/[id]/route.ts`;
  `src/app/api/admin/customers/[id]/register/route.ts`;
  `src/app/api/admin/customers/[id]/addresses/route.ts`;
  `src/app/api/admin/customers/[id]/addresses/[addressId]/route.ts`;
  `scripts/api/{t-customers,t-customers-concurrency,t-customers-unit}.mjs`;
  this doc.
- Modified: none (beyond pre-existing working-tree entries).
- Untouched/protected: `db/*`, `prisma/*`, `src/lib/auth/*`,
  `src/lib/api/*`, BA-1/BA-2/BA-3 code + routes, `docs/AGENT-HANDOFF.md`.

## 13. Deferred / open (unchanged + new)

- Customer self-service auth/OTP/password-reset — deferred (no frozen
  customer session model exists).
- `customers.manage` permission split — deferred (needs arch decision).
- Phone-number change on a customer — not offered (identity immutable).
- Customer hard-delete — not offered (RESTRICT pins + history).
- Weighted-barcode formula, R7 auto-cap, cart TTL, versioning — as before.
