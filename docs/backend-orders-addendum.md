# BA-6 Addendum — Order Journey Contract

> **Addendum to:** [`docs/backend-orders.md`](file:///D:/Hyper_el-moatasem/docs/backend-orders.md) — the frozen BA-6 execution record.
> **Status:** authoritative for the order domain **as implemented today**.
> **Recorded:** 2026-10-30 — under `Post-Phase-11 Residual Remediation & Integrity Closure`.
> **Rule:** `docs/backend-orders.md` is **not** modified by this addendum. Where the two disagree,
> this addendum is the newer statement; the original stays as the historical BA-6 record.

---

## 1. Purpose of this addendum

`docs/backend-orders.md` was written as the **BA-6 execution record** and froze the order domain at
that moment. Three later changes moved the contract underneath it:

1. The authorization model moved from a **client-supplied `customerId`** to a **server-derived session**.
2. Delivery pricing gained **admin-managed delivery zones** and a **client-reviewed fee handshake**
   (`expectedDeliveryFee`).
3. Guest access matured from "a token exists" to a **hash-only, fixed-TTL, revocable,
   per-order credential** with a **separate read-only checkout recovery session**.

This addendum records the contract that the running code actually implements, with the file and
line that proves each statement. It adds no behaviour and no policy: it only describes what exists.

---

## 2. Authorization model — session-derived, never client-supplied

### 2.1 The rule

> The **identity of a customer is derived from the authenticated session only**.
> `customerId` **never travels** in a request body, a query string, or a path segment.

### 2.2 What replaced what

| Concern | `docs/backend-orders.md` §8 (old) | Implemented now | Proof |
|---|---|---|---|
| `GET /api/store/orders` | `?customerId=` (own) | `requireCustomer(request)` ⇒ owner resolved from the session cookie / `x-customer-token`; a `customerId` parameter is ignored | `src/app/api/store/orders/route.ts:5,165` |
| `GET /api/store/orders/[id]` | `?customerId=` (own) | same model — session only | `src/app/api/store/orders/[id]/route.ts` |
| `POST /api/store/orders/[id]/cancel` | `{ customerId }` (own) | `orderCancelSchema = z.object({}).strict()` ⇒ the body must be **exactly empty**; any `customerId` is a 400 `VALIDATION` | `src/lib/orders/validation.ts:108-110` |

### 2.3 Why the change is safe

A `customerId` supplied by the caller is an **authority claim**, not an identity. The session is
signed by the server, so the server can answer "whose order is this?" without trusting the caller.
The two hardening suites that would have caught the old shape are still green:

| Suite | What it proves |
|---|---|
| `t-store-idor.mjs` | a foreign order id returns **404**, never data |
| `t-guest-orders.mjs` | guest credential scoping, expiry (410), revocation (401) |

### 2.4 A guest order is not a customer order

An order created as a guest has `orders.customer_id IS NULL`. It is **not** linked to a later
customer account by matching a phone number or a name. A guest order stays a guest order; its only
owner is the **possession of its per-order credential** (§5). Consequently:

* A registered customer **cannot** see a guest order by signing up.
* A guest credential **cannot** be used to act as a registered customer.
* The checkout **recovery session** (§5.4) is bound to exactly one guest order and is **read-only**.

---

## 3. Order lifecycle

### 3.1 The seven frozen states

`src/lib/orders/state-machine.ts` — the names are frozen by the database
(`chk_orders_status` + `chk_history_transition`); **no other state exists**.

```
NEW → CONFIRMED → PREPARING → READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED
```

with `CANCELLED` reachable only from the first three.

| From | Allowed next states |
|---|---|
| `NEW` | `CONFIRMED`, `CANCELLED` |
| `CONFIRMED` | `PREPARING`, `CANCELLED` |
| `PREPARING` | `READY_FOR_DELIVERY`, `CANCELLED` |
| `READY_FOR_DELIVERY` | `OUT_FOR_DELIVERY` |
| `OUT_FOR_DELIVERY` | `DELIVERED` |
| `DELIVERED` | *(terminal)* |
| `CANCELLED` | *(terminal)* |

### 3.2 Cancel policy — unpicked only

Cancel is allowed from `NEW | CONFIRMED | PREPARING` **and only when every order line is unpicked**.
A picked line requires restock movements that the fulfillment phase owns, so the server refuses:

```ts
// src/lib/orders/writes.ts:605-619
SELECT id::text AS id, status FROM orders WHERE id = ${args.orderId}::uuid FOR UPDATE;
…
throw conflict("Order has picked lines and cannot be cancelled here.", { status });
```

* The refusal is **409 `CONFLICT`** — never a 500. Proof: `t-order-journey-d6.mjs` assertion
  `item7-refusal-is-not-internal`.
* The refused order **keeps its state** and **gets no history row**
  (assertions `item7-order-not-cancelled`, `item7-no-cancel-history`).

### 3.3 Locking order (every mutation)

| Step | Lock | Statement |
|---|---|---|
| 1 | order row | `SELECT … FROM orders WHERE id = … FOR UPDATE` |
| 2 | inventory rows | `SELECT 1 FROM inventory WHERE product_variant_id = … FOR UPDATE` (ASC order) |
| 3 | history row | insert `order_status_history` |

Consequence: two concurrent cancels produce **one winner (200) and one 409**, exactly **one**
history row, and the reservation is released **once** (assertions `item8-*`).

---

## 4. Delivery contract

### 4.1 `expectedDeliveryFee` is mandatory

```ts
// src/lib/orders/writes.ts:427-453
const feeResolution = await resolveDeliveryFee(tx, address);
const feeCents = feeResolution.cents;
if (args.expectedDeliveryFee == null) {
  throw new ApiError("VALIDATION", "expectedDeliveryFee is required: review the delivery fee before ordering.", null);
}
if (priceToPiastres(args.expectedDeliveryFee) !== feeCents) {
  throw conflict("Delivery fee changed since the order was reviewed.", {
    reason: "DELIVERY_FEE_CHANGED", currentDeliveryFee: feeResolution.fee });
}
```

| Case | Response | Effect |
|---|---|---|
| `expectedDeliveryFee` **absent** or `null` | **400 `VALIDATION`** | no order, no reservation, no inventory movement |
| value ≠ the server's current fee | **409 `CONFLICT`**, `details.reason = DELIVERY_FEE_CHANGED`, `details.currentDeliveryFee` | no order, no side effect |
| value = the server's current fee | **201** | order created |

The **client value is never used to compute the final price.** It is only a *claim about what the
customer was shown*; the server re-reads the fee and remains the sole authority.

### 4.2 Gate ordering — the idempotency key is never burned by a fee refusal

```
1. idempotency-key lookup  ──►  replay of a committed order → 200 (the stored order, unchanged)
                             └─►  a committed order with a different body → 409
2. session / guest subject resolution
3. cart resolution and validation
4. expectedDeliveryFee gate        ← 400 / 409 here
5. inventory reservation + order insert (one transaction)
```

Because the fee gate sits **after** the idempotency lookup, a client that retries a fee-refused
request with the same key still receives the correct 409/400 and the key remains usable.
Asserted by `t-orders.mjs`: `fee-missing-400`, `fee-missing-no-order`, `fee-mismatch-409`,
`fee-mismatch-no-order`, `fee-corrected-201`, `replay-200`, `replay-no-dup-reserve`,
`replay-single-row`, `replay-without-fee-200`, `key-conflict-409`, `drift-409`,
`drift-no-side-effects`.

### 4.3 Fee resolution precedence

`src/lib/orders/delivery-fee.ts:70-95`:

| Priority | Source | Notes |
|---|---|---|
| 1 | an **active** `delivery_zones` row matching the address | locality match order: **area → village → city**; the admin controls the fee per zone |
| 2 | `store_settings` key `delivery.default_fee` | the store-wide default (seeded at **20.00 EGP**) |

The resolution result reports `source` (`ZONE` | `DEFAULT`), `zoneId`, `zoneName` and
`matchedField`, so the audit trail can say *why* a fee was charged.

> **`delivery.enabled` is a reserved setting.** It is **not read anywhere in `src/`**
> (`src/lib/orders/delivery-fee.ts:14`). It exists so an admin can record the intent; the fee
> handshake above is what actually decides the price. Do not infer "delivery is off" from it.

### 4.4 The client side

`src/components/store/checkout-flow.tsx` obtains the fee from a **live preview**
(`quotedDeliveryFee()`), sends it as `expectedDeliveryFee`, and on a `409 DELIVERY_FEE_CHANGED`
re-reads the preview instead of retrying blindly. The frontend **hides** the action but the server
is the authority — see §6.1.

---

## 5. Guest access — the per-order credential

### 5.1 Shape

| Property | Value | Source |
|---|---|---|
| Transport | header **`x-guest-order-token`** — never a URL | `src/lib/orders/guest-access.ts` |
| Granularity | **one credential per order** | `issueGuestOrderCredential(tx, orderId)` |
| Storage | **SHA-256 hash only**; the raw token is returned **once** at issuance and never persisted | `hashToken` / `newOpaqueToken` |
| Lifetime | **90 days, fixed** (`GUEST_ORDER_CREDENTIAL_TTL_DAYS = 90`) — no sliding extension | `src/lib/orders/guest-order-cookie.ts:23` |
| Expiry clock | computed **in SQL** from `now()`; never from a JS clock, never from a read | `guest-credential-policy.test.ts` |
| Revocation | a `revoked_at` flag; a revoked credential answers **401** | `src/lib/orders/guest-access.ts` |
| Idempotent replay | the **same** credential is returned for the same idempotency key | `t-orders.mjs` replay assertions |
| Expiry response | **410 `GONE`** (expired) vs **401** (invalid / revoked) | `requireGuestOrder` |

### 5.2 The order number is not authority

Neither the order number, the phone number, nor the name grants read or cancel rights on its own.
Proof: `t-store-idor.mjs` and the D6 assertions `item5-number-does-not-grant-read`,
`item5-number-does-not-grant-cancel`, `item5-anonymous-number-401`, `item5-guest-number-401`.

### 5.3 Read path ordering (fail-closed)

`src/lib/orders/guest-access.ts:271-295`:

```
1. rate-limit bucket for the read identity  ──►  429 before any credential work
2. credential validity                      ──►  401 (invalid / revoked) | 410 (expired)
3. order row ownership                      ──►  404 (not a guest order / not yours)
```

The rate-limit check runs **first** so a flood of bogus tokens cannot be used to probe credential
validity.

### 5.4 The checkout recovery session — a **different** credential

| Property | Value |
|---|---|
| Purpose | let a guest **read** the order they just placed, without the order credential |
| Lifetime | **24 hours, fixed** — deliberately shorter than the 90-day order credential |
| Storage | hash only, in its own table; a **different cookie name** and a **different header** |
| Binding | bound to **exactly one** order id; it cannot read another order |
| Authority | **read-only** — no mutating route opts into it (`guest-credential-policy.test.ts`) |
| Revocation | an explicit revoke (200); after that the session answers 401 |

Separating the two is deliberate: the **recovery session is a short-lived, low-privilege read
grant**, while the **order credential is the long-lived owner credential**. Recovery authority is
therefore **not** order-mutation authority, and it is **admin/staff-only** — there is no
guest self-recovery path after the credential expires.

### 5.5 Regression protection

`src/lib/orders/__tests__/guest-credential-policy.test.ts` — 14 assertions pinning the policy above
(90-day credential, 24-hour recovery session, hash-only storage, `__Host-` prefix in production,
`HttpOnly` + `SameSite=Lax` + `Secure` in production, header-not-URL transport, no expiry extension
on read, no mutating route opting into the recovery session).

---

## 6. The full journey (D6) — what is now covered

The 20-item order-journey coverage list is implemented across three layers. The item numbers below
are the original list's numbering.

### 6.1 Authority is the server, not the frontend

The frontend may hide or disable a control, but **the server rejects the disallowed operation
even when it is sent directly by the client**. Proof: `item4-credential-A-cannot-cancel-B`
(401 / `CONFIRMED` — the target order is untouched) and
`item5-number-does-not-grant-cancel`.

### 6.2 Coverage by item

| Items | Where | Representative assertions |
|---|---|---|
| 4 — credential isolation | `scripts/api/t-order-journey-d6.mjs` | `item4-credential-A-cannot-read-B`, `item4-cart-bearer-cannot-read-order`, `item4-no-leak`, `item4-own-credential-still-works` |
| 5 — the order number is not authority | `scripts/api/t-order-journey-d6.mjs` | `item5-number-does-not-grant-read`, `item5-key-probe-no-disclosure`, `item5-key-probe-leaves-order-intact` |
| 7 — picked lines block cancel | `scripts/api/t-order-journey-d6.mjs` | `item7-cancel-after-pick-409`, `item7-refusal-is-not-internal` |
| 8 — concurrent cancel | `scripts/api/t-order-journey-d6.mjs` | `item8-one-winner-one-conflict`, `item8-single-history-row`, `item8-reservation-released-once` |
| 16 — checkout recovery session | `scripts/api/t-order-journey-d6.mjs` | `item16-hash-only`, `item16-fixed-24h-ttl`, `item16-session-cannot-mutate`, `item16-session-revoked-with-credential` |
| 11 — ambiguous outcomes | `src/app/actions/__tests__/order-mutations.test.ts` | the announcement never claims success before the server confirms |
| 17 / 19 — focus management | `src/app/actions/__tests__/order-mutations.test.ts` | focus moves to the result line; `document.activeElement !== document.body` |
| 18 — live region | `src/app/actions/__tests__/order-mutations.test.ts` | the live region exists **before** any result exists |
| 20 — accessibility gate | `e2e/order-journey-pages.spec.ts` | axe-core: **zero** violations on the order operation controls |
| pages — end-to-end journey | `e2e/order-journey-pages.spec.ts` | `OJ-A` registered customer (list → detail → confirmation), `OJ-B` guest (own credential opens, foreign does not), `OJ-C` cancel changes the server state, `OJ-D` a rate-limited read renders the Arabic notice (not a 404), `OJ-E` an empty list shows a real heading |

### 6.3 The rate-limited read (OJ-D)

A rate-limited guest read must render the **Arabic notice**, never a generic "order not found".
This is the specific defect fixed in this closure: the order page used to turn a `RATE_LIMITED`
response into a 404.

---

## 7. What did **not** change

The boundaries of BA-6 are still in force. This addendum does **not** introduce, imply, or approve:

| Not present | Note |
|---|---|
| a payment method or a payment flow | checkout ends at order creation |
| OTP / SMS / email verification | — |
| a refund, return, or exchange policy | — |
| a delivery SLA or a delivery window | the fee is a price, not a promise |
| a customer-facing support channel | see §7.1 |
| a new price, discount, or commercial fee | the default fee stays **20.00 EGP**, admin-managed |
| a **customer account** for a guest | guest checkout never forces account creation |
| any link between a guest order and a later account | see §2.4 |
| `AUTO_ACCEPTED` as an automatic trigger | see §7.2 |
| a new order state or transition | the seven frozen states are unchanged |

### 7.1 Support channel

The storefront states explicitly that the support channel is **not configured**
(`src/app/order-help/page.tsx:82-85`). No phone number, e-mail address, or WhatsApp link is
displayed anywhere, because no contact data was provided by the store owner. The status of this
item is **`OWNER-CONTACT-DATA-NOT-PROVIDED`**.

### 7.2 `AUTO_ACCEPTED`

There is **no automatic trigger** that emits `AUTO_ACCEPTED`. The decision source is never the
frontend. Only a specific, proven, sanctioned internal backend path may emit it, and it must record
the decision source and the reason in the audit trail. Until such a path is proven, the operation is
refused with a **business-rule message (409)**, never a 500.

---

## 8. Status table

| Finding | Initial state | Action | Verification | Final status |
|---|---|---|---|---|
| `GET /api/store/orders` trusted `?customerId=` | stale in the doc | documented; the code was already session-derived | `src/app/api/store/orders/route.ts:5,165` + `t-store-idor.mjs` | `SAFE-POLICY-DECIDED` |
| Cancel body documented as `{customerId}` | stale in the doc | documented; the code rejects any non-empty body | `src/lib/orders/validation.ts:108-110` | `SAFE-POLICY-DECIDED` |
| Delivery fee documented as default-only | stale in the doc | documented the zone precedence | `src/lib/orders/delivery-fee.ts:70-95` | `SAFE-POLICY-DECIDED` |
| `expectedDeliveryFee` undocumented | **absent from the doc** | documented as mandatory, with the 400/409 contract | `src/lib/orders/writes.ts:427-453` + `t-orders.mjs` (12 assertions) | `FIXED-VERIFIED` |
| Guest credential TTL / hash / revocation undocumented | **absent from the doc** | documented the whole credential policy | `guest-credential-policy.test.ts` (14 assertions) | `FIXED-VERIFIED` |
| Recovery session undocumented | **absent from the doc** | documented; 24 h, read-only, one order | `item16-*` assertions (14) | `FIXED-VERIFIED` |
| Order number as authority | impossible by construction | unchanged; asserted | `item5-*` assertions | `VERIFIED-NO-FIX-REQUIRED` |
| Cancel by picked line | 409 already | unchanged; asserted to be 409, never 500 | `item7-*` assertions | `VERIFIED-NO-FIX-REQUIRED` |
| Concurrent cancel | one winner already | unchanged; asserted | `item8-*` assertions | `VERIFIED-NO-FIX-REQUIRED` |
| `RATE_LIMITED` rendered as 404 | **defect** | fixed in the order page | `e2e/order-journey-pages.spec.ts` `OJ-D` | `FIXED-RUNTIME-VERIFIED` |
| Focus / live region / empty state | **defects** | fixed | `order-mutations.test.ts` + `OJ-E` | `FIXED-RUNTIME-VERIFIED` |
| Support channel | not provided by the owner | left explicitly unconfigured | `src/app/order-help/page.tsx:82-85` | `OWNER-CONTACT-DATA-NOT-PROVIDED` |
| `AUTO_ACCEPTED` automatic trigger | absent by decision | left absent; refusals are business-rule errors | `src/app/api/admin/replacements/[id]/auto-accept/route.ts` | `SAFE-POLICY-DECIDED` |

---

## 9. Companion documents

| Document | Covers |
|---|---|
| `docs/backend-orders.md` | the original frozen BA-6 record (**not modified**) |
| `docs/openapi.yaml` | the machine-readable contract (101 paths, 142 methods) |
| `docs/backend-application-contract.md` | the whole application contract |
| `docs/backend-customer-checkout.md` | the checkout flow |
| `docs/customer-authentication.md` | the customer session model |
| `docs/backend-catalog.md` / `docs/backend-inventory.md` | the catalog and stock sides of an order |
