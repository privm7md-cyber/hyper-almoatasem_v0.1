# Proxy Trust Model & Rate Limiting

> **Scope:** how this application decides *who the client is* for rate limiting and for the audit
> trail, and what happens when that identity cannot be established.
> **Status:** binding. Recorded 2026-10-30 under
> `Post-Phase-11 Residual Remediation & Integrity Closure`.
> **Implementation:** [`src/lib/api/client-ip.ts`](file:///D:/Hyper_el-moatasem/src/lib/api/client-ip.ts),
> [`src/lib/auth/rate-limit.ts`](file:///D:/Hyper_el-moatasem/src/lib/auth/rate-limit.ts).

---

## 1. The problem this policy solves

A rate-limit bucket is only as strong as the identity that keys it. If the client can choose that
identity, the limit is bypassed by **rotating a header** — no amount of tuning the limit helps.
So the first question is never "what limit?" but **"can the client pick its own key?"**

`x-forwarded-for` is the header clients most often try to forge. On some deployments it is
trustworthy; on others the client writes it verbatim.

---

## 2. The hosting environment — established, not assumed

| Evidence | Value |
|---|---|
| `.vercel/project.json` | project `hyper-almoatasem-v0-1` |
| live domains | `*.vercel.app` |
| `VERCEL=1` | set by the platform on every Vercel deployment, at **build and run time** |

> **Governing design rule: the platform is detected from the ENVIRONMENT, never from a header.**
> A client therefore cannot impersonate the platform by sending a header.

---

## 3. What the provider guarantees (official documentation)

* `vercel.com/docs/headers/request-headers` states:
  > *"we currently overwrite the X-Forwarded-For header and do not forward external IPs. This
  > restriction is in place to prevent IP spoofing."*
* `vercel.com/docs/environment-variables/system-environment-variables` documents `VERCEL`.

| Header | Verdict | Reason |
|---|---|---|
| `x-vercel-forwarded-for` | **trusted on Vercel** | the platform-written copy; it is the one that survives a proxy placed **in front of** Vercel |
| `x-forwarded-for` | **trusted on Vercel** (single value only) | the platform overwrites it, so only the real client address reaches it |
| `x-real-ip` | **not used** | documented as *identical* to `x-forwarded-for` — not an independent source, and relying on it would fake an independence that does not exist |
| `x-forwarded-for` on a self-hosted server | **not trusted** | Next.js fills it with the socket peer address **only when the client omitted it**; a client-supplied value is kept verbatim |

The self-hosted behaviour is visible in Next.js 16.3.8 itself:
`next/dist/server/base-server.js` — `req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress`.

---

## 4. The trust model in code

`resolveClientIp` in `src/lib/api/client-ip.ts`:

```
1) isVercelRuntime(env)        → source = "vercel-platform"
     x-vercel-forwarded-for (single value) → accepted
     x-forwarded-for     (single value) → accepted
     otherwise                          → UNKNOWN

2) isDeclaredTrustedProxy(env)  → source = "declared-proxy"
     x-forwarded-for (single value only) → accepted
     otherwise                          → UNKNOWN

3) anything else                → source = "unknown", ip = null
```

### 4.1 Invalid values are rejected

```ts
export function parseSingleIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "" || value.includes(",")) return null;   // a chain is ambiguous ⇒ reject
  return isIP(value) !== 0 ? value : null;               // IPv4 + IPv6 only
}
```

| Rule | Detail |
|---|---|
| **single value only** | a comma-separated chain is rejected — the hop count is not known from evidence, so it is not guessed |
| **IPv4 and IPv6** | `node:net` `isIP()` — no hostnames, no free text |
| **reserved ranges** | `0.0.0.0` / `::` / `255.255.255.255` / multicast / link-local are rejected |
| **absent header** | `UNKNOWN` |
| **safe behaviour when unknown** | a **shared, non-bypassable bucket** — `UNKNOWN_CLIENT_IP = "unknown"` |

> **Why rejecting a chain matters:** in `X-Forwarded-For: a, b, c` the **first** value is the one a
> client can poison. "Take the first value" *is* "accept forgery". Rejecting is the safe choice.

### 4.2 Fail-closed when the identity is unknown

Every request whose identity cannot be established joins **one shared bucket**. A client that hides
its address:

* **gains** no additional allowance (the bucket is shared by everyone);
* is **not** given a forged identity that could be used to slip past IP-based limits;
* does **not** disable the limit — the limit still applies, it is simply applied to a shared key.

---

## 5. Rate-limit buckets

`src/lib/auth/rate-limit.ts`.

| Bucket | Limit | Window | Key |
|---|---|---|---|
| `admin_auth_rate_limits` — IP | `IP_BUCKET_LIMIT = 30` | 15 min | trusted IP |
| `admin_auth_rate_limits` — account | `ACCOUNT_BUCKET_LIMIT = 10` | 15 min | account |
| `customer_auth_rate_limits` | `ACCOUNT_BUCKET_LIMIT = 10` | 15 min | account / IP |
| customer registration — IP | `REG_REGISTER_IP_LIMIT = 30` | 15 min | trusted IP |
| customer registration — phone | `REG_REGISTER_PHONE_LIMIT = 10` | 15 min | the phone (hashed) |
| `guest_order_rate_limits` — create | `GUEST_ORDER_CREATE_BUCKET_LIMIT = 10` | 15 min | trusted IP |
| `guest_order_rate_limits` — read | `GUEST_ORDER_READ_BUCKET_LIMIT = 60` | 15 min | trusted IP |
| checkout session | `GUEST_CHECKOUT_SESSION_BUCKET_LIMIT = 20` | 15 min | trusted IP |

`RATE_WINDOW_MINUTES = 15` is fixed for every bucket.

### 5.1 Window alignment

The window starts are **clock-aligned**, not sliding:

```sql
date_trunc('hour', now()) + floor(date_part('minute', now()) / 15) * interval '15 minutes'
```

Every bucket therefore shares the same boundaries, and a burst that straddles a boundary is
counted against two windows rather than being split unpredictably.

### 5.2 Counting semantics

`checkAndRecordRateLimit` **always** increments the counter, including on a rejected request, and
then decides `allowed = attempts <= limit`. A rejected request therefore still consumes allowance —
the limit cannot be walked past by retrying.

### 5.3 Bucket keys are never logged

A bucket key embeds the identity it derives from, so only the **bucket family** is logged. See
[`docs/logging-and-audit-policy.md`](file:///D:/Hyper_el-moatasem/docs/logging-and-audit-policy.md) §3.1.

---

## 6. Deployment settings — documented, not changed

| Variable | Recommended value | Where | Action |
|---|---|---|---|
| `VERCEL` | `1` | set automatically by Vercel | **none** |
| `TRUSTED_PROXY` | `1` **only** if a proxy in front of Vercel replaces `x-forwarded-for` with a single value | environment | **none** (not set) |

> The default posture is **untrusted**: with no `TRUSTED_PROXY=1`, an unprovable identity becomes
> the shared unknown bucket. That is the safe default and requires no configuration.

**No hosting, DNS or deployment setting was changed by this work.**

---

## 7. How the trust model is proven

`scripts/api/t-proxy-identity.mjs` runs the server in the **untrusted posture** (no
`TRUSTED_PROXY`, no `VERCEL`) and fires **18 forged-header variations**:

```
ipv4-a, ipv4-b, ipv4-c, ipv4-d, ipv4-e,
ipv6-a, ipv6-b, ipv6-full,
chain-2, chain-3, chain-spaces,
invalid-hostname, invalid-text, invalid-port,
local, local-v6, unspecified, broadcast, absent
```

Every variation — a forged IPv4, a forged IPv6, a chain, a malformed value, a reserved address, or
no header at all — lands in the **same `unknown` bucket**, and the limit engages exactly at its
threshold. A freshly forged address sent *after* the limit engaged is still limited and still joins
the same bucket.

The suite also asserts that the audit row for a failed login carries **no client IP** — an
unprovable address is never recorded as if it were known.

> The suite is **window-aware**: it detects the 15-minute window boundary and re-measures inside a
> single window, so the assertion is not a race with the clock. The measurement itself is asserted
> (`guest-read-window-aligned`), so a mis-measurement fails the suite instead of passing silently.

---

## 8. Operational consequences

| Situation | Behaviour |
|---|---|
| the client rotates `x-forwarded-for` | no effect — the key never changes |
| the client sends a chain | the whole header is rejected → `unknown` bucket |
| the client sends a malformed value | rejected → `unknown` bucket |
| the client omits the header | `unknown` bucket |
| the app runs on Vercel | the platform-written header is used, single value only |
| the app runs behind a trusted proxy | the declared proxy's single value is used |
| the app runs self-hosted with no declaration | shared `unknown` bucket — conservative, never weaker |
