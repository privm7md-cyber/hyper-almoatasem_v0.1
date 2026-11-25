# Credential & Session TTL Policy

> **Scope:** every long-lived credential this application issues — guest order credentials, guest
> checkout recovery sessions, customer sessions and admin sessions — and the rules that keep them
> from outliving their purpose.
> **Status:** binding. Recorded 2026-10-30 under
> `Post-Phase-11 Residual Remediation & Integrity Closure`.
> **Implementation:** [`src/lib/orders/guest-access.ts`](file:///D:/Hyper_el-moatasem/src/lib/orders/guest-access.ts),
> [`src/lib/orders/guest-checkout-session.ts`](file:///D:/Hyper_el-moatasem/src/lib/orders/guest-checkout-session.ts),
> [`src/lib/orders/guest-order-cookie.ts`](file:///D:/Hyper_el-moatasem/src/lib/orders/guest-order-cookie.ts),
> [`src/lib/customers/auth.ts`](file:///D:/Hyper_el-moatasem/src/lib/customers/auth.ts),
> [`src/lib/auth/session.ts`](file:///D:/Hyper_el-moatasem/src/lib/auth/session.ts).

---

## 1. The policy in one paragraph

Every credential is stored **hash-only**, travels over a **dedicated transport**, expires on a
**fixed** schedule computed **inside the database**, and is **revocable**. Expiry is **never**
extended by a read. Authority is **not** shared between a short-lived convenience grant and a
long-lived owner credential: the guest checkout recovery session is a **read-only, 24-hour,
single-order** grant, while the guest order credential is the **90-day owner** credential.
**Recovery authority is admin/staff-only** — there is no guest self-recovery path once a credential
has expired.

---

## 2. The four credentials

| Credential | Lifetime | Transport | Authority | Storage |
|---|---|---|---|---|
| **Guest order credential** | **90 days**, fixed | header `x-guest-order-token` (never a URL) | owner of one guest order | SHA-256 hash only |
| **Guest checkout recovery session** | **24 hours**, fixed | its own cookie / its own header | **read-only**, one order | SHA-256 hash only |
| **Customer session** | 30 days | `__Host-customer-session` / `x-customer-token` | a registered customer | hash only, server-side row |
| **Admin session** | 8 hours | `__Host-admin-session` | an administrator | hash only, server-side row |

### 2.1 Where the numbers come from

```ts
export const GUEST_ORDER_CREDENTIAL_TTL_DAYS = 90;      // src/lib/orders/guest-order-cookie.ts:23
export const GUEST_CHECKOUT_SESSION_TTL_HOURS = 24;      // src/lib/orders/guest-checkout-session.ts:32
export const CUSTOMER_SESSION_TTL_DAYS = 30;             // src/lib/customers/auth.ts:41
export const SESSION_TTL_HOURS = 8;                      // src/lib/auth/session.ts:28
```

These values are **fixed by decision** and are not adjusted at runtime.

---

## 3. Rules that apply to every credential

### 3.1 Hash-only storage

The raw token is returned **once**, at issuance, and is **never persisted**. Only its SHA-256 hash
is stored. This applies to the guest order credential and the checkout recovery session alike.

### 3.2 The clock is the database's clock

Expiry is computed in SQL:

```sql
now() + ($1::text || ' days')::interval
```

Not from a JavaScript clock, and never from a value the client supplied. The expiry is stored as a
`TIMESTAMPTZ` and compared in the database, so there is a single source of time.

### 3.3 No sliding extension

Reading a credential **never** extends its life. There is no `UPDATE … SET expires_at` on the read
path — the regression test asserts exactly that.

### 3.4 Revocation is explicit and immediate

* a guest order credential carries a `revoked_at` flag; a revoked credential answers **401**;
* a checkout recovery session has an explicit revoke endpoint; after it, the session answers **401**;
* admin and customer sessions are server-side rows, so they are revocable by deleting or flagging
  the row — no token needs to be remembered client-side.

### 3.5 Transport

| Credential | Transport | Never |
|---|---|---|
| guest order credential | `x-guest-order-token` header | **never in a URL** — a URL leaks through the browser history, referrers and server logs |
| checkout recovery session | its own cookie name and its own header | never mixed with the order credential's transport |
| customer session | `__Host-customer-session` cookie or `x-customer-token` header | — |
| admin session | `__Host-admin-session` cookie | — |

### 3.6 Cookie attributes

| Attribute | Value |
|---|---|
| `HttpOnly` | always |
| `SameSite` | `Lax` |
| `Secure` | **in production** |
| `Path` | `/` |
| `Domain` | **never set** (required by the `__Host-` prefix) |

The `__Host-` prefix is the strongest form browsers offer, but they **reject** a `__Host-` cookie
that is not `Secure` + `Path=/` + domain-less. A real local development process therefore uses a
separate, non-prefixed name; the production name always carries the prefix.

---

## 4. The guest order credential

| Property | Value |
|---|---|
| Granularity | **one per order** |
| Issuance | inside the order-creation transaction — `issueGuestOrderCredential(tx, orderId)` |
| Storage | SHA-256 hash only; the raw token is returned **once** in the creation response |
| Lifetime | **90 days**, fixed |
| Idempotent replay | the **same** credential is returned for the same idempotency key |
| Revocation | `revoked_at` flag |
| Expired | **410 `GONE`** |
| Invalid or revoked | **401** |

### 4.1 Read-path ordering (fail-closed)

```
1. rate-limit bucket for the read identity  ──►  429
2. credential validity                      ──►  401 (invalid / revoked) | 410 (expired)
3. order row ownership                      ──►  404
```

The rate-limit check runs **first**, so a flood of forged tokens cannot be used to probe which
tokens are valid.

### 4.2 The order number is not a credential

The order number, a phone number and a customer name grant **no** read or cancel rights. A guest
order belongs to the **holder of its credential**, and to nobody else.

---

## 5. The checkout recovery session — deliberately weaker

The recovery session exists so a guest can **read** the order they just placed, without keeping the
long-lived order credential.

| Property | Value |
|---|---|
| Lifetime | **24 hours**, fixed — much shorter than the 90-day order credential |
| Storage | hash only, in its own table |
| Transport | a **different cookie name** and a **different header** from the order credential |
| Binding | bound to **exactly one** order id |
| Authority | **read-only** — no mutating route opts into it |
| Revocation | explicit; after revocation the session answers 401 |

Because it is read-only and single-order, it cannot be escalated into order-mutation authority,
and it cannot be used to reach another order.

---

## 6. No guest self-recovery

When a guest credential expires, the customer **cannot** recover access themselves. Recovery is an
**admin/staff-only** action, and it:

* **must not disclose** anything that would let a caller enumerate other orders;
* **must be separated** from order-mutation and cancel authority — the actor who recovers access
  is not thereby authorised to change or cancel the order.

This is a deliberate policy limit, not a missing feature.

---

## 7. Regression tests

`src/lib/orders/__tests__/guest-credential-policy.test.ts` — 14 assertions that pin the whole
policy:

| Assertion | Pins |
|---|---|
| `keeps the guest order credential at 90 days` | the 90-day lifetime |
| `keeps the cookie lifetime aligned with the credential lifetime` | cookie and credential expire together |
| `keeps the checkout recovery session at 24 hours` | the 24-hour recovery lifetime |
| `computes both expiries in SQL from now(), never from a sliding read` | the database clock |
| `never extends an expiry on read — no UPDATE writes expires_at` | no sliding extension |
| `stores only the hash of the token` | hash-only storage |
| `hashes the checkout session token the same way` | same guarantee for the recovery session |
| `uses the __Host- prefix in production and a separate dev name` | cookie naming |
| `sets HttpOnly, SameSite=Lax, Secure in production and Path=/` | cookie attributes |
| `carries the credential in a header, never in a URL` | transport |
| `uses a different cookie name and a different header` | separation of the two credentials |
| `reads the session from its own header or cookie only` | no cross-reading |
| `is read-only: no mutating route opts into the checkout session` | the read-only guarantee |

---

## 8. Changing a TTL — the checklist

1. Change **one** constant; do not inline a number.
2. Keep the cookie lifetime aligned with the credential lifetime.
3. Extend the `guest-credential-policy.test.ts` expectations in the same change.
4. Confirm the change does not turn the recovery session into an owner credential.
