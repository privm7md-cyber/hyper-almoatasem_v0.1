# BA-D Customer + Addresses + Checkout — implementation record

> Backend APIs only. No frontend. No BA-E. No schema/migration changes.
> All behavior verified on scratch (`hyper_almoatasem_scratch`); production
> untouched (every test connection is allowlisted to scratch names only; the
> Next server under test pointed at scratch).

## 1. Audit verdict (no rewrite)

BA-D began with a mandatory audit of the BA-4 (customers) and BA-6
(orders/checkout) implementations. Verdict: **both are real application
services, not test doubles — reused, not rewritten.**

- Customer/address logic lives in `src/lib/customers/{phone,validation,
  serialize,queries,writes}.ts`, called by thin routes under
  `src/app/api/store/customers/identify/` and
  `src/app/api/admin/customers/…`. Single phone-normalization service
  (`phone.ts`, R8 ladder); SELECT→INSERT→reselect-on-P2002 convergence;
  address ownership scoped `(id, customerId)` → 404; at-most-one-default via
  partial UQ + one-tx switch with 409 losers.
- Checkout lives in `src/lib/orders/writes.ts` (`createOrder`/`cancelOrder`),
  called thinly by `src/app/api/store/orders/route.ts`. One Prisma
  `$transaction`: cart `FOR UPDATE` → customer/address validation → live line
  revalidation → promo engine → ASC inventory locks → atomic conditional
  reserve → order + snapshot items + history → `CHECKED_OUT`. Address
  snapshots are FK-free copies on the order row (post-order address
  mutation/deletion cannot move history).
- Test doubles: `db/tests/**` carries *declared* reference doubles encoding
  frozen SQL rules (INTEGRATION DOUBLE — acceptable, must not be cited as
  app-service coverage). All `scripts/api/t-*.mjs` suites drive the real HTTP
  API (direct SQL only for fixture guards, fault injection, and cleanup).
  Unit suites (`t-*-unit.mjs`) test real pure modules with no DB/HTTP.
  **No production-code doubles exist** (zero `mock`/`fake`/`stub` in prod
  paths; `double-*` hits are race names and English prose).

Actual gaps found (closed by the new suite, §8): address snapshot immunity
was proven for price but never for product-name/address mutation; no single
end-to-end journey (identify → addresses → merge → piece+weight → promo →
coupon → estimate → reprice → checkout); no address-mutation race at checkout
time; same-phone race capped at 3-way; no failed-key-reuse proof; no
delete-default state proof; customer-cart (tokenless) checkout path exercised
only implicitly.

## 2. Customer identity (frozen, re-verified in BA-D context)

- `POST /api/store/customers/identify` `{phone, firstName, lastName?}` →
  201 created / 200 existing (same id, name frozen at first identify).
- Canonical `2010XXXXXXXXX` via the single R8 ladder; ladder rejections →
  422, blank/malformed → 400. `password_hash` never leaves the server
  (asserted absent on every identify response).
- 8-way concurrent same-phone identify → all 2xx, one id, one DB row.
- Convergent identity is immediately usable: 8 parallel identifies then
  checkout with the single id → `order.customer_id` matches.
- Frozen identity model (documented, not a bug): no customer auth/OTP exists,
  so a guest cart checks out against whichever valid `(customerId,
  addressId)` pair it supplies, provided the address belongs to that
  customer. Proven by `frozen-binding-201`; cross-customer address use →
  deterministic 404 with zero side effects.

## 3. Addresses (frozen shape, re-verified)

- Shape: `label?`, `city*`, `area?`, `village?`, `street?`,
  `building_number?`, `landmark?`, `phone*`, `is_default`. **No
  governorate** — extra keys → 400 (strict objects).
- Admin RBAC routes only (`customers.view` closest-capability mapping, BA-4
  precedent; no storefront address book in frozen scope).
- Default: at most one per customer (partial UQ); switch = unset-old +
  set-new in one tx; concurrent switches → legal `{200,200}` (serialized)
  or `{200,409}` (UQ loser) — invariant is *exactly one default*, proven
  under contention.
- Delete the default is allowed → zero defaults remain (legal) → a new
  default is settable afterwards. Hard delete; orders keep snapshots.

## 4. Guest → customer upgrade

`identify by phone` + `POST /api/store/cart/merge {customerId}` (guest
bearer): reassign when the customer has no cart (token retired → 404),
per-line sum + live reprice otherwise. After merge the customer cart is the
ACTIVE customer cart — checkout runs **without** a guest token
(`{customerId, addressId, idempotencyKey}` only) → 201 CONFIRMED.

## 5. Full journey (money proof, one order)

Guest → identify → 2 addresses + default switch → guest cart (P330 ×2 +
Romi 0.125 kg) → merge → 10% LINE promo on P330 + 20.00 ORDER coupon →
estimate → reprice → checkout. Verified exact:

```text
P330  15.00 × 2     = 30.00  (PIECE, BARCODE 6221001000331)
Romi 320.00 × 0.125 = 40.00  (KG, INTERNAL_CODE 2010106)
gross 70.00 − promo 3.00 − coupon 20.00 (discountTotal 23.00)
+ delivery 20.00 = total 67.00
```

`estimate == checkout` (23.00 both). Inventory reserved exactly
(+2.000 / +0.125), coupon `used_count` 1, `order_discounts` ≥ 2, cart
`CHECKED_OUT`, history `NULL→NEW→CONFIRMED` (actor CUSTOMER).

## 6. Snapshot immunity

Post-checkout catalog rename (Pepsi → MUTATED → back) and address
mutation leave the order frozen (item name/price/totals, delivery
city/street/phone). Deleting the used address afterwards still leaves the
full order snapshot readable.

## 7. Checkout races (deterministic outcomes)

- Address PATCH × checkout (3 rounds): every round is 201 with the delivery
  snapshot exactly the pre- or post-patch triple (never torn), or 404 with
  no order row.
- Address DELETE × checkout (3 rounds): 201 with the full pre-delete
  snapshot, or 404 with no order row, no reservation delta, cart still
  ACTIVE.
- Failed key reuse: drift-409 on key K → fix price → reuse K → 201 →
  replay K → 200 same id (`meta.replay`).
- Same-phone 8-way + immediate checkout (§2); coupon single-winner and
  same-cart replay covered BA-6/BA-8, re-verified green.

## 8. Tests

| Suite | Result |
|---|---|
| `scripts/api/t-bad-customer-checkout.mjs` (HTTP on scratch, 64 asserts) | 64/64 ×3 runs |
| `scripts/api/t-customers.mjs` | 66/66 |
| `scripts/api/t-customers-concurrency.mjs` | 8/8 |
| `scripts/api/t-customers-unit.mjs` | 40/40 |
| `scripts/api/t-orders.mjs` | 54/54 |
| `scripts/api/t-orders-concurrency.mjs` | 15/15 |
| `scripts/api/t-orders-unit.mjs` | 17/17 |
| Phase 2 functional | 77/77 |

Full regression (cart, inventory, promotions, replacements, admin, BA-A/B/C,
auth/RBAC, atomicity, idempotency, deadlock, audit-pairing, Phase 4/5):
green, see AGENT-HANDOFF.md §5. `tsc --noEmit` / ESLint (0 warnings) /
`npm run build` PASS.

Regression notes (environmental, not product): back-to-back runs can exhaust
the frozen login buckets (IP 30 / account 10 per 15 min → generic 401 by
design — suites spaced across rollovers); one replacements run caught an
orphaned P1L `reserved_quantity = 1.000` with no owning order (scratch
residue from an interrupted run — reset after verifying zero referencing
rows, then 54/54 + 12/12 green).

## 9. Files

- New: `scripts/api/t-bad-customer-checkout.mjs`; this doc.
- Modified: none (BA-D is verification-only; zero src changes).
- Untouched/protected: `db/*`, `prisma/*`, all `src/**`, `docs/AGENT-HANDOFF.md`
  (BA-D status block appended separately), `docs/release-manifest.md`.

## 10. Deferred (unchanged)

Customer OTP/login/sessions, password reset/invitation routes, MFA,
`customers.manage` permission split, phone-number change, customer
hard-delete, storefront address self-service (no frozen surface),
picking/fulfillment transitions, payments, delivery mechanics,
notifications — none invented here.
