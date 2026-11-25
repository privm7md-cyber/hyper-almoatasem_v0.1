# Logging & Audit Trail Policy

> **Scope:** every structured server log line and every audit-trail row this project writes.
> **Status:** binding. Recorded 2026-10-30 under
> `Post-Phase-11 Residual Remediation & Integrity Closure`.
> **Implementation:** [`src/lib/api/log.ts`](file:///D:/Hyper_el-moatasem/src/lib/api/log.ts),
> [`src/lib/api/log-events.ts`](file:///D:/Hyper_el-moatasem/src/lib/api/log-events.ts),
> [`src/lib/api/audit.ts`](file:///D:/Hyper_el-moatasem/src/lib/api/audit.ts).

---

## 1. The policy in one paragraph

Operational logging is **allowlisted and minimal**: an event must be registered before it can be
logged, and each event carries only its declared fields. Everything else is **dropped** at the
event layer. A second, independent layer sanitises the surviving fields — recursively, cycle-safe,
depth-bounded and **fail-closed**. The audit trail is a **separate** mechanism with its own rules
(see §5). **No request body, no response body, no credential, no personal contact data and no
client-chosen address ever reaches a log line.**

---

## 2. Two independent layers

```
┌─ layer 1: ALLOWLIST (log-events.ts) ────────────────────────────┐
│  the event name must be in the registry                          │
│  only the fields declared for that event survive                 │
│  a bucket FAMILY is logged, never the bucket key                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌─ layer 2: SANITIZER (log.ts) ────────────────────────────────────┐
│  forbidden-key list applied to every key at every depth          │
│  cycle-safe (WeakSet) · depth-bounded (12) · fail-closed         │
└──────────────────────────────────────────────────────────────────┘
```

The layers are **independent**: a field that slips through layer 1 is still dropped by layer 2.
Neither layer trusts the other, and neither trusts the caller.

---

## 3. Layer 1 — the allowlisted event registry

`src/lib/api/log-events.ts`:

```ts
export const OPERATIONAL_EVENTS = {
  "rate_limit.exceeded": { fields: ["scope", "limit", "attempts", "table"] },
  "authz.denied":       { fields: ["permission", "reason"] },
  "internal.error":     { fields: ["code", "surface"] },
  "config.invalid":     { fields: ["name"] },
} as const;
```

| Rule | Behaviour |
|---|---|
| an **unregistered** event | dropped — no line is written at all |
| a field **not declared** for the event | dropped — only the declared fields are copied |
| the **bucket key** | never logged; the **bucket family** is logged instead |

### 3.1 Bucket families

A rate-limit bucket key embeds the identity it was derived from (an IP, an e-mail, a phone
number or their HMAC). Logging the key would leak that identity, so only the family is logged:

| Prefix | Logged family |
|---|---|
| `guest-order:read-ip:` | `guest-order-read` |
| `guest-checkout-session:ip:` | `guest-checkout-session` |
| `guest-order:ip:` | `guest-order-create` |
| `login:cust-ip:` | `customer-login-ip` |
| `login:cust-acct:` | `customer-login-account` |
| `login:ip:` | `admin-login-ip` |
| `login:acct:` | `admin-login-account` |
| `reg:cust-ip:` | `customer-register-ip` |
| `reg:cust-acct:` | `customer-register-phone` |
| *(anything else)* | `unclassified` — never an echo of the key |

Longest prefixes are matched first, so a family is never truncated into another one.

### 3.2 What is never logged

Deliberately absent from every log line and every audit row:

IP addresses · phone numbers · e-mail addresses · order identifiers · request/response bodies ·
tokens · cookies · `authorization` headers · connection strings · any secret.

---

## 4. Layer 2 — the sanitiser

`src/lib/api/log.ts`.

### 4.1 Forbidden keys

```
password · passwordHash · password_hash · token · tokenHash · token_hash ·
cookie · cookies · set-cookie · authorization · database_url · api_key · secret
```

* Matching is **case-insensitive and substring-based**, so `customerToken`, `x_guest_token`,
  `Set-Cookie` and `DATABASE_URL` are all covered.
* The list is applied to **every key at every depth**, so a secret nested inside a payload is
  dropped exactly like a top-level one.

### 4.2 Cycle-safe

```ts
function sanitizeValue(value, depth, ancestors: WeakSet<object>): unknown {
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try { … } finally { ancestors.delete(value); }
}
```

`ancestors` holds the objects **on the current path only**, so a true cycle is cut while a shared
(non-circular) reference is serialised twice — which is the correct behaviour and the reason a
`Set` is not used here.

### 4.3 Depth-bounded

`MAX_DEPTH = 12`. Anything deeper is replaced by `"[truncated]"`.

### 4.4 Fail-closed

| Surface | Behaviour on failure |
|---|---|
| `logEvent` | if the sanitiser throws, **no line is written** — there is no "write it raw" path |
| `auditPayload` | `catch { return null; }` — the payload is **dropped**, never stored unsanitised |

> Principle: **losing detail is recoverable; storing a secret is not.**

---

## 5. The audit trail

`src/lib/api/audit.ts` is a **separate** mechanism from the operational log.

| Property | Behaviour |
|---|---|
| **Transaction-bound** | `auditInTx(tx, event)` — the INSERT precedes the COMMIT inside the same transaction, so a failed operation leaves no audit row, and a failed audit rolls the operation back |
| **Centrally sanitised** | `auditPayload()` calls `sanitizeLogFields` — sanitisation is never left to the call site |
| **Request context** | `resolveRequestContext()` supplies IP and User-Agent to every audit site without threading them through the signature |
| **IP only under proven trust** | recorded **only** with `TRUSTED_PROXY=1`; otherwise it stays `NULL` rather than logging a header the client chose |
| **No cookie, no token** | the path reads no cookie, no `authorization` header, no session and no guest token |

See [`docs/proxy-trust-and-rate-limiting.md`](file:///D:/Hyper_el-moatasem/docs/proxy-trust-and-rate-limiting.md)
for the trust model that decides whether the IP is recordable.

---

## 6. "No random logging on every route"

| Measurement | Value |
|---|---|
| `logEvent` / `logOperationalEvent` call sites in `src/` (excluding tests) | **5** |
| `console.*` in `src/` outside `src/lib/api/log.ts` | **0** |

The call sites are all **high-value operational or security events** with a narrow field set:

```
src/lib/auth/rate-limit.ts:156                     logOperationalEvent("rate_limit.exceeded", {scope, limit, attempts, table})
src/lib/auth/rbac.ts:93                             logOperationalEvent("authz.denied", {permission, reason:"unauthenticated"})
src/lib/auth/rbac.ts:97                             logOperationalEvent("authz.denied", {permission, reason:"missing_permission"})
src/lib/api/respond.ts:40                          logOperationalEvent("internal.error", {code})
src/app/api/store/customers/register/route.ts:96    logOperationalEvent("config.invalid", {name})
```

There is **no route that logs a request body or a response body**, and no per-request logging.

---

## 7. The sink — and its documented limits

| Item | Decision |
|---|---|
| Sink | the **platform log stream** (Vercel logs in production, process stdout locally) plus the `audit_logs` table |
| A new monitoring service | **none was introduced** — no provider, no key, no configuration |
| Known limits | the stream is **unstructured JSON lines**, with no alerting and no retention policy managed by this project |

The limits are recorded here rather than hidden. No monitoring product is invented to cover them.

---

## 8. Regression tests

| File | Assertions | What it pins |
|---|---|---|
| `src/lib/api/__tests__/log.test.ts` | 11 | forbidden keys dropped (top level, nested, inside arrays, at arbitrary depth), case-insensitive matching, surrounding payload not corrupted, **the secret value never appears anywhere**, non-primitive values preserved, **cycles cut**, a shared reference serialised twice, **the depth limit** |
| `src/lib/api/__tests__/log-events.test.ts` | 7 | only the declared event fields survive, everything else dropped, **no address leak**, bucket family without identity, no family truncated into another, an unknown key produces no echo |
| `src/lib/api/__tests__/audit.test.ts` | 3 | a nested secret in an audit payload is dropped, a legitimate payload survives intact, **a cycle is cut instead of failing the transaction** |

---

## 9. Adding a log line — the checklist

1. Register the event in `OPERATIONAL_EVENTS` and declare **only** the fields it needs.
2. Call `logOperationalEvent(...)`, never `logEvent(...)` directly.
3. Never pass an identity-bearing value. If a bucket is involved, pass `bucketScope(key)`.
4. If the value must be free-text, it must already be non-sensitive — the sanitiser is the last
   line of defence, not the first.
