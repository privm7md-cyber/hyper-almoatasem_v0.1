# FP-11.7 — Customer Account UX Specification

> Classification: `VERIFIED FROM CURRENT CONTRACT` (repo/openapi/code evidence below) · `LOCKED`
> (existing approved decision) · `RECOMMENDATION` (proposed, needs owner review) · `BLOCKED —
> CONTRACT GAP` · `UNSUPPORTED BY CURRENT API` · `FUTURE PROPOSAL`. Specification only — no
> implementation, no backend change. D40 and D42 are OWNER-APPROVED — DECISION RECORDED (this task);
> D40, D41 and D42 are OWNER-APPROVED — DECISION RECORDED (D41 approved this task within its
> defined limitations). Nothing else herein is owner-approved.

## 1. Document metadata and status

- **File:** `docs/frontend/FP-11-7-CUSTOMER-ACCOUNT-UX-SPECIFICATION.md` (new).
- **Phase:** FP-11.7 Customer Account UX, Hyper Al-Moatasem storefront.
- **Basis:** read-only inspection of store customer routes, domain code, `docs/openapi.yaml`, and
  FP-11.4/FP-11.5/FP-00/FP-04 (consumed unchanged).
- **Status: `SPECIFICATION COMPLETE — D40/D41/D42 OWNER-APPROVED`.** No capability
  invented; every screen traces to a verified endpoint or an explicit gap.

## 2. Scope and non-goals

**In scope.** Login, registration, account landing, order history + order detail (read), saved-address
CRUD + default handling, password change, logout, guest/authenticated separation, return navigation,
all UI states, mobile/RTL/a11y, security rules, acceptance criteria, decision register.

**Non-goals.** Implementation; backend/DB/config changes; OTP/phone verification; password
reset/recovery; profile editing (unsupported — §9); account deletion; session listing/revocation
beyond current-logout + password-change-revokes-all; email flows; payments/delivery/tracking;
admin UX (FP-11.8); FP-11.6+.

## 3. Verified contract and evidence sources

Read-only inspection; no execution claimed as test evidence.

| # | Capability | Evidence | Status |
|---|---|---|---|
| E1 | Login: `POST /api/store/customers/session` `{phone, password}` → 200 `{customer, customerToken, expiresAt}` + HttpOnly `__Host-customer-session` cookie (SameSite=Lax, Secure in prod); failures uniform generic 401 (`رقم الهاتف أو كلمة المرور غير صحيحة.`) | `store/customers/session/route.ts:42-72`, `customers/auth.ts:172-273` (Argon2id + dummy-timing + lockout + buckets), `openapi.yaml:359-386` | VERIFIED |
| E2 | Lockout + rate limits: 5 fails → 15-min lock (atomic, DB-clock); customer buckets IP 30 / acct 10 per 15 min (isolated table); 401-generic on throttle (fail-closed) | `customers/auth.ts:38-39,190-245`, `auth/rate-limit.ts:29-35` | VERIFIED |
| E3 | Session: opaque 64-hex bearer, SHA-256 at rest, 30-day fixed TTL (no sliding), DB-gated expiry/revocation; transports: HttpOnly cookie (primary) / `x-customer-token` header; no CSRF-token endpoint (SameSite=Lax only) | `customers/session.ts:22-97`, `customers/cookies.ts` | VERIFIED |
| E4 | Registration: `POST /api/store/customers/register` `{phone, firstName, lastName?, password}` → 201 + session auto-established (cookie + token, NO separate login); ladder failure / policy breach → 400 generic; duplicate REGISTERED phone → 409 (documented enumeration surface); guest-row conversion transparent; rate-limited IP 30 + HMAC phone 10 /15min → generic 429 (G5, secret-bound, fail-closed) | `store/customers/register/route.ts`, `customers/auth.ts:79-170`, `auth/rate-limit.ts` + `reg-phone-bucket.ts`, `openapi.yaml:387-406` | VERIFIED |
| E5 | Phone R8 ladder: Egyptian mobiles 010/011/012/015 → canonical `201XXXXXXXXX`; ladder failure → 400 (register) / 422 (identify); shapes accept `010…/1…/201…/+201…/00201…` | `customers/phone.ts:17-34`, `customers/validation.ts:10-13`, openapi identify 422 | VERIFIED |
| E6 | Password policy: length 12–128 ONLY (no complexity classes); shared admin/customer minimum | `auth/password.ts:10-36` | VERIFIED |
| E7 | Profile read: `GET /api/store/customers/session` → 200 `{customer, addresses}` / 401; `CustomerShape{id,firstName,lastName,phone,email,isRegistered,autoAcceptReplacements,isActive,createdAt,updatedAt}` (hash never leaves server) | `store/customers/session/route.ts:74-85`, `customers/serialize.ts:9-35` | VERIFIED |
| E8 | NO storefront profile-update route: `customerPatchSchema` exists but no store route consumes it (store customers dir has session/password/addresses/identify/register only) → firstName/lastName/email/autoAccept edits UNSUPPORTED | store route inventory + grep (no `customerPatch` consumer in store) | VERIFIED ABSENT |
| E9 | Password change: `PATCH /api/store/customers/password` `{currentPassword, newPassword}` → 200 `{passwordChanged:true}`; verifies current (wrong → 401 generic); policy-checks new (breach → 400 via domain throw); revokes ALL sessions incl. current → re-login mandatory | `store/customers/password/route.ts:13-45`, `customers/auth.ts:281-306`, `openapi.yaml:407-424` | VERIFIED |
| E10 | Logout: `DELETE /api/store/customers/session` → 200 `{loggedOut:true}`; revokes CURRENT token only; clears cookie; tokenless call still 200+clear (safe retry) | `store/customers/session/route.ts:87-93`, `customers/session.ts:99-108` | VERIFIED |
| E11 | Addresses: `GET` list / `POST` create / `GET-PATCH-DELETE /{addressId}` (owner server-derived, foreign → 404); create needs `{city*, phone*}` rest optional; `isDefault:true` switches default (unset-old + set-new, single-default invariant, concurrent race → 409); PATCH partial owner-immutable; DELETE hard (orders keep snapshots; unaudited) | address routes + `customers/validation.ts:68-94` + `customers/writes.ts:199-327` + `openapi.yaml:425-503` | VERIFIED |
| E12 | Orders (read): `GET /api/store/orders` (keyset cursor, `idempotencyKey` echoed) + `GET /{id}` (session ownership, 404 foreign); snapshots only | `store/orders/route.ts:141-166`, `store/orders/[id]/route.ts`, `orders/serialize.ts` | VERIFIED |
| E13 | Order cancel (follow-up, unpicked NEW/CONFIRMED/PREPARING only; 409 picked/further) exists post-creation; detail deferred to FP-11.6 account-order flows | `store/orders/[id]/cancel/route.ts`, `orders/writes.ts:542-627` | VERIFIED (pointer only) |
| E14 | Guest bootstrap: `POST /customers/identify` `{phone, firstName, lastName?}` → 200/201 identity only — NEVER a session (phone alone is not a credential) | `store/customers/identify/route.ts:1-41`, `openapi.yaml:340-358` | VERIFIED |
| E15 | No OTP / phone verification / password reset / recovery / session listing / revoke-others / email flows anywhere in store API | store route inventory + grep (`otp|reset|verify` — only "No OTP/login invented" comment) | VERIFIED ABSENT |
| E16 | Guest separation: guest cart bearer (`x-guest-token`) vs order credential (`x-guest-order-token`, BGGO-D014/FP-04 §14/FP-11.5) vs session — never interchanged; merge explicit only; no silent guest→registered conversion (registration converts the ROW only via credentialed register) | FP-11.4 §4 + FP-11.5 §§6/16 + `customers/auth.ts:108-138` | VERIFIED |
| E17 | Prior specs consumed unchanged: FP-11.4 (counts, XOR, merge messaging, D30 A/B/C), FP-11.5 (checkout boundary, coupon ownership, D39 gap), FP-00 (nav, COD abstraction OPEN), FP-04 (journey, no-gateway-UI, guest-access §14) | `docs/frontend/FP-11-{4,5}…`, FP-00, FP-04 | VERIFIED (read) |

## 4. Authentication and session model

- **Credential:** phone (R8 canonical) + password (Argon2id). Password is a login-time secret ONLY —
  never stored, never reused as a session substitute, never in URLs/logs/analytics.
- **Session establishment:** login/register responses set the HttpOnly cookie AND return `customerToken`
  (same value; non-browser same-origin clients send `x-customer-token`). `expiresAt` is display
  metadata (30d fixed); expiry is DB-enforced, never JS-compared.
- **Request auth:** cookie primary, header fallback (`customers/cookies.ts`). No CSRF token contracted;
  SameSite=Lax is the only built-in cross-site posture — state-changing actions additionally require
  the single-flight guards in §§12–13, never a custom CSRF header (none verified).
- **Expiry/invalidation/logout taxonomy (do not conflate):** 401-missing/invalid/expired/revoked
  (all generic) → login prompt, input preserved; explicit logout (DELETE → 200, current revoked,
  cookie cleared); password change (ALL revoked → mandatory re-login, §10); network failure (no
  request reached server — NEVER log out; retry, §13); authorization failure (404 foreign disguised —
  never logout).
- **Rate/lockout UX:** throttled or locked accounts receive the SAME generic 401 message (backend
  never distinguishes) — UI shows the generic message + `حاول لاحقًا` guidance without claiming a
  lockout it cannot verify. No countdown timers (no contracted remaining-time field).
- **Session responses expose nothing sensitive:** `toCustomer` carries no hash; tokens travel in
  cookie/body-once, never URL.

## 5. Customer registration specification

- **Entry:** `إنشاء حساب` from header/account icon or post-guest prompt (guest checkout NEVER forced —
  registration is optional, FP-11.5).
- **Fields:** الهاتف* (any ladder form) · الاسم الأول* (1–80) · اسم العائلة (optional) · كلمة المرور*
  (12–128 chars, length-only policy — UI states exactly that, no complexity rules invented) ·
  تأكيد كلمة المرور (client-side match check, never sent).
- **Client pre-checks:** required-present, ladder-shape plausibility (digits/`+` only), length bounds,
  confirmation match. Server is authoritative (R8 + policy).
- **Submit:** `POST /register` → 201: session auto-established (no login step); navigate per §12
  (default account overview). 400 → generic `بيانات التسجيل غير صالحة` + field hints (ladder vs
  policy indistinguishable — say so, don't fake precision). 409 → `هذا الرقم مسجل بالفعل — سجل الدخول`
  with login link (backend deliberately 409s — documented enumeration surface, so stating it is
  honest, not a leak the UI introduces).
- **Rate limiting (G5, live):** isolated buckets IP 30 + HMAC-bound phone 10 per 15 min
  (secret `REG_RATE_LIMIT_PHONE_SECRET`; missing/invalid fails closed 500) → generic 429
  (`Too many requests.`) with backoff + retry; single-flight still required. IP buckets assume the
  deployment edge determines the client IP — locally `X-Forwarded-For` is client-controlled, so the
  phone bucket is the independent defense (see FP-11.8.2 E16.7). **No email field** (schema has none). **No OTP step** (unsupported — never rendered).

## 6. Customer login specification

- **Fields:** الهاتف* · كلمة المرور* (+ `إظهار/إخفاء` toggle, masked default).
- **Submit:** `POST /session` → 200 `{customer, customerToken, expiresAt}`: persist nothing sensitive
  beyond the HttpOnly cookie (browser-managed); `customerToken` body value is for non-browser clients —
  browser UI MUST NOT duplicate it into `localStorage` (no verified need; cookie suffices).
- **Failure:** every 401 → generic `رقم الهاتف أو كلمة المرور غير صحيحة.` (server's own Arabic string,
  safe to display verbatim) + preserved phone + retry. Never distinguish unknown/wrong/inactive/
  locked/throttled. 400 → malformed body (client bug class).
- **Single-flight + no success-before-confirm** (FP-00-D035 forbidden-optimism respected).
- **Post-login routing** per §12 (safe internal return-or-fallback; D42).

## 7. Customer account landing page (D40 OWNER-APPROVED — DECISION RECORDED)

- **Route:** account overview (e.g. `/account`) — requires valid session; 401 → login with return
  destination preserved (D42).
- **Heading:** `حسابي` (h1). Greeting + canonical phone from the verified session read ONLY
  (`أهلاً {firstName}` + `201XXXXXXXXX` display) — identity shown iff `GET /session` 200 for the
  current user; never from cached/stale or other-customer data.
- **Sections (D40):** (1) identity block (§7 heading rule); (2) shortcuts: طلباتي (`/account/orders`)
  · عناويني (`/account/addresses`) · الأمان (`/account/security`: password change + logout) — every
  item maps to a supported route/capability (§15); (3) latest-orders preview (first page of
  `GET /orders`, max 5, read-only rows: number/status/total/date);
  (4) default-address summary (if any). Conditional profile facts: `email` shown ONLY if non-null
  (storefront never sets it — display-only); `autoAcceptReplacements` shown as informational
  status (not editable, E8).
- **Session/security note (supported):** single informational line where useful
  (`جلستك الحالية نشطة` — derived from the 200 session read, never a verified-expiry claim).
- **Explicitly unsupported (never linked, no fake forms, no simulated success, no invented
  endpoints):** profile editing; email/phone editing; password reset/recovery; OTP verification;
  listing/revoking other sessions; account deletion; any access to unrelated guest orders
  (credential-gated, never listed here); account metrics/statistics (no authoritative source).
  Unsupported items are OMITTED from nav (no disabled fake entries, no "coming soon" promises).
- **Data:** single `GET /session` (customer + addresses) + `GET /orders?limit=5` for preview.
- **State handling:** per-section skeletons → content → guided empty (`لا توجد طلبات بعد` + browse
  CTA; no addresses → add-address CTA). A FAILED section (transport/500) renders an error card with
  retry — NEVER as an empty result. 401 renders the unauthorized state (login prompt), never an
  empty account. Logout reflects the real `DELETE /session` outcome: 200 → cleared + navigate;
  transport/server failure → session-presumed-live, error + retry, NO "logged out" claim (per §13).

## 8. Order history and order details

- **History:** `GET /orders` keyset pages (default 20, cap 100; `nextCursor null` = end — same
  conventions as FP-11.2). Row: `orderNumber` hero (never bare UUID), status (frozen machine names,
  Arabic labels), `totalEstimated`, item count, `createdAt`. Newest-first (server order).
- **Detail:** `GET /orders/{id}` → snapshot lines + delivery snapshot + history + fulfillment-evolved
  `totalFinal` when non-null. 404 → not-found (unknown OR foreign — never distinguished).
  Cancel affordance surfaced ONLY where the contracted cancel route allows (unpicked states);
  cancel flow itself is FP-11.6 scope — here a pointer link with the 409-picked rule noted, not a
  re-specified flow (E13).
- **Ownership:** phone/order-number lookup grants nothing; session ownership server-enforced. Guest
  orders NEVER appear here (no session ↔ guest linkage; `customer_id NULL` rows are credential-gated).

## 9. Address management

- **List:** `GET /addresses` → owned rows; render default-first (client ordering by
  `isDefault desc`, then recency — display-only, D41), each with label/city/area/phone + default badge.
- **Create:** same field contract as FP-11.5 §7 (city*+phone*, rest optional, trim-only, no
  governorate). `isDefault:true` switch supported → 201; concurrent 409 → re-list + reselect
  (E11 — default IS a real API behavior, not an inferred field).
- **Update:** `PATCH /{addressId}` partial (incl. `isDefault:true` to move default; owner-immutable).
  404 → removed-as-gone path. **Saved-address edits NEVER rewrite order snapshots** — state explicitly
  (`تعديل العنوان المحفوظ لا يغيّر عناوين الطلبات السابقة`); checkout uses live `addressId` at submit.
- **Delete:** `DELETE /{addressId}` → `{deleted:true}`; HARD delete (no restore). Confirmation sheet
  REQUIRED (destructive, irreversible); 404 → treat-as-gone + re-list. Orders keep snapshots —
  deletion never touches history. No "referenced-by-order" restriction verified (none in code) —
  do NOT invent a blocked-delete rule; if a future FK ever blocks, map its real error then.
- **Checkout interplay:** FP-11.5 D33 explicit-selection rule preserved (account shows default badge;
  checkout still requires explicit pick).

## 10. Password and security features

- **Change (supported):** fields current* + new* + confirm*; policy note (12–128); submit
  `PATCH /password` → 200: show `تم تغيير كلمة المرور — سجل الدخول مجددًا` + route to login
  (ALL sessions revoked incl. current — re-auth mandatory, E9). Wrong current → generic 401
  (no "wrong password" precision beyond the generic string). Policy breach → 400-mapped length message.
- **Logout (supported):** `تسجيل الخروج` → `DELETE /session` → 200: clear UI state, land on home/login;
  tokenless retry still 200 (safe). Distinguish from expiry (no user action) in copy.
- **Unsupported (never rendered as working):** password reset/recovery, OTP, session list,
  revoke-others, email change, profile edit, account deletion — each marked `UNSUPPORTED BY CURRENT
  API` in §15/§17 with safest fallback (e.g. "contact support" is NOT promised as a recovery path
  for credentials — no verified support flow; instead state unavailability plainly).

## 11. Guest-versus-authenticated separation

| Aspect | Authenticated (session) | Guest (no session) |
|---|---|---|
| Identity | `__Host-customer-session` / `x-customer-token`, 30d server sessions | Cart bearer `x-guest-token` (draft cart) + per-order `x-guest-order-token` (order access) |
| Profile/account page | Full (§7) | None — guests have no profile; completing an order grants none |
| Orders | Own list/detail via ownership (E12) | Credential-gated per-order reads only (FP-11.5); never in history |
| Addresses | Saved CRUD (E11) | Inline per-order snapshots only (FP-11.5 §6) |
| Conversion | N/A | Only via credentialed `register` (guest-row conversion, E4) — never silent, never via identify/cart/order |
| Merge | Explicit `POST /cart/merge` only (FP-11.4 D27) | Same rule from the other side; login alone merges nothing |

Four secrets never conflated: cart token ≠ order token ≠ session ≠ order id/number (§16 rules).
Guest-token recovery limits (FP-11.5 D39 BLOCKED) restated, not re-solved.

## 12. Navigation and post-login routing (D42 OWNER-APPROVED — DECISION RECORDED)

- **Account nav:** overview (`/account`) · orders (`/account/orders`, detail `/account/orders/{id}`) ·
  addresses (`/account/addresses`) · security (`/account/security`: change + logout only). Header
  account icon ↔ login/account per session; bottom nav unchanged (FP-03 locked).
- **Return-target policy (D42, centralized):** when an unauthenticated customer hits a protected
  customer route, the intended destination is preserved as a `next` value ONLY if eligible; after
  successful login it is validated AGAIN before navigating (double-gate: capture-time + post-login).
  1. Eligible = same-origin absolute-path customer destinations in the explicit allowlist:
     `/cart`, `/checkout`, `/account`, `/account/*`, `/` (exact paths; `*` = single path-prefix rule
     implemented with the framework router, not substring matching).
  2. Missing/invalid → deterministic fallback `/account` (post-login) or `/` (post-logout).
  3. REJECTED (→ fallback, never navigated): absolute external URLs (`https://…`), protocol-relative
     (`//host`), backslash variants (`\/`, `\\`), encoded-path tricks (`%2F`, `%5C`, `%00`, double
     encoding), malformed/ambiguous forms, auth routes (`/login`, `/register`, `/logout` — loop
     prevention), non-customer routes (admin/storefront-public destinations that need no return).
  4. Validation uses the framework's URL parser on a normalized value (parse → same-origin check →
     path allowlist); a leading `/` alone is NOT sufficient.
  5. NEVER place tokens, session credentials, guest-order tokens, passwords, or secrets in `next`
     (query values are logged/history-visible by nature).
  6. The target is a navigation PREFERENCE, not authorization: protected pages re-enforce session +
     ownership independently after arrival; an unauthorized-after-login destination renders its 401/404
     state (never a bypass). Normal Back/Forward preserved; no redirect loops (auth routes excluded
     + fallback terminal).
- Checkout-initiated login returns to checkout with address step reset (FP-11.5 §4.2). No sign-in gate
  before guest checkout, ever.

## 13. Loading, validation, empty, success, and error states

| State | Behavior |
|---|---|
| Initial/loading | Skeletons (`aria-busy`), layout-stable; session check first (unknown → hold nav, not flash) |
| Validation | Inline per-field Arabic, `aria-describedby`; submittable only when client-valid (server authoritative) |
| Empty | Orders/addresses guided empties with CTAs (never bare zeros) |
| Success | Only on confirmed 200/201 (login/register/logout/password/address/order reads); transient confirm + navigate |
| 400 | Shape/breach → field-level fix, no retry loop |
| 401 | Generic message; login-origin → retry; session-origin → re-login (preserve non-sensitive input); NEVER auto-logout on network failure |
| 401-unauthorized-page | Protected account route without session → login prompt + eligible `next` preserved (D42); never an empty account, never a bypass |
| 404 | Address/order gone → re-list/not-found (never leak foreign existence) |
| 409 | Duplicate phone → login link; default-race → re-list + reselect |
| 422 | Ladder/phone-identity failures (identify path) → fix phone |
| 429/500/offline | Backoff + retry, state preserved; offline badge, no destructive action |
| Logout result | 200 → cleared + navigate + transient confirm; transport/5xx failure → error + retry, session presumed live, NO success claim; tokenless retry still safe (idempotent 200-shape) |

## 14. Mobile, RTL, accessibility, and responsive requirements

- Mobile-first single column; sticky primary CTA safe-area-aware; 44px targets; bottom nav intact.
- `dir=rtl`, logical properties, `bdi`-isolated phones/numbers/dates; mirrored directional icons only.
- Labeled inputs, error association, `aria-live="polite"` for auth/order/address outcomes,
  focus-to-error-summary and focus-to-success-heading, visible focus (FP-10 pairs), Esc-dismissed
  sheets with focus restore; destructive confirms trap focus.
- Western numerals + `ج.م`; canonical `201XXXXXXXXX` display; no WCAG claim without testing.
- Brand tokens as locked (Purple `#511D9C`, Orange `#FF7100` text-restricted, Text Orange `#C2410C`,
  Ink `#1B1530`, surfaces `#EEE8F5`/`#FFF1E6`, Success `#15803D`, Error `#C62828`); font deferred.

## 15. API-to-screen mapping

| Screen/field | Method + route | Request | Response use | Errors | Evidence | Verification |
|---|---|---|---|---|---|---|
| Login | `POST /customers/session` | `{phone, password}` | `{customer, customerToken, expiresAt}` + cookie | 400/401-generic | E1/openapi 359-386 | VERIFIED |
| Register | `POST /customers/register` | `{phone, firstName, lastName?, password}` | 201 + auto session | 400/409 | E4/openapi 387-406 | VERIFIED |
| Overview/profile | `GET /customers/session` | Session | `{customer, addresses}` | 401 | E7 | VERIFIED |
| Orders history | `GET /orders` (+cursor) | Session | List incl. key echo | 401 | E12 | VERIFIED |
| Order detail | `GET /orders/{id}` | Session | Snapshots + history | 401/404 | E12 | VERIFIED |
| Cancel pointer | `POST /orders/{id}/cancel` `{}` | Session | Status change (FP-11.6 detail) | 404/409 | E13 | VERIFIED (pointer) |
| Addresses list | `GET /customers/addresses` | Session | Owned rows | 401 | E11 | VERIFIED |
| Address create | `POST /customers/addresses` | `{city*,phone*,…}` | Created row | 400/401/409 | E11 | VERIFIED |
| Address get/patch/delete | `GET-PATCH-DELETE /{addressId}` | UUID + partial | Row / `{deleted:true}` | 400/401/404/409 | E11 | VERIFIED |
| Password change | `PATCH /customers/password` | `{currentPassword, newPassword}` | `{passwordChanged:true}` → re-login | 400/401 | E9 | VERIFIED |
| Logout | `DELETE /customers/session` | Session (optional) | `{loggedOut:true}` + clear | Always 200-shape | E10 | VERIFIED |
| Guest bootstrap | `POST /customers/identify` | `{phone, firstName, lastName?}` | Identity only, NO session | 400/422 | E14 | VERIFIED |

Unsupported (never mapped as available): profile PATCH, password reset/OTP/recovery, session
list/revoke-others, email flows, account deletion, order lookup by phone/number.

## 16. Security and privacy rules

1. Passwords: login-time secrets only; never stored/persisted/logged; masked default + explicit
   reveal; browser UI never duplicates `customerToken` into `localStorage` (cookie suffices).
2. Sessions: HttpOnly cookie primary; no URL/analytics/log/debug exposure; generic 401s (never
   distinguish); lockout/rate never displayed as verified state.
3. Four-credential separation (§11); order number/phone never authorize.
4. Guest tokens obey FP-11.5/BGGO-D014/FP-04 §14 (BGGO storage key, header-only, masked, ack gate,
   D39 limits restated).
5. No transient-failure logout; no success-before-confirm (FP-00-D035); strict-schema extras never sent.
6. Customer data minimized: render only contracted fields; `email` display-only when non-null.

## 17. Open questions and backend gaps

| # | Gap | Impact | Status |
|---|---|---|---|
| G1 | No storefront profile update (firstName/lastName/email/autoAccept) | Name corrections, email capture, replacement prefs unchangeable self-service | BLOCKED — CONTRACT GAP |
| G2 | No password reset/recovery/OTP | Locked-out-forgotten-password users have no self-service path | BLOCKED — CONTRACT GAP (never rendered) |
| G3 | No session list / revoke-others | Stolen-device session hygiene limited to password-change-nukes-all | BLOCKED — CONTRACT GAP |
| G4 | No account deletion | Retention-only posture; no UX promised | UNSUPPORTED BY CURRENT API |
| G5 | Registration rate limiting — IMPLEMENTED + HMAC-HARDENED (this task) | Isolated `reg:` buckets (IP 30 + HMAC phone 10 /15min, `REG_RATE_LIMIT_PHONE_SECRET`, fail-closed, rotation orphans counters) on existing table (no migration); generic 429; duplicate-409 preserved; unit 9/9 + live 14/14 + customer-auth 37/37 | `register/route.ts` gate + `reg-phone-bucket.ts` + `rate-limit.ts` + openapi 429 + `.env.example` placeholder | IMPLEMENTED + VERIFIED; env readiness: local secret lives Git-ignored in `.env.local` (server-side only, never `NEXT_PUBLIC_`, live-proven 201); Preview-only variable registered by metadata (active Preview deployment NOT proven to consume it — new build required, not triggered) |
| G6 | No order-number/phone guest lookup in account | By design (ownership); guests stay credential-gated | VERIFIED ABSENT (by design) |

## 18. Decision register with explicit status and rationale

> `RECOMMENDATION` = proposed, awaiting owner approval. `OWNER-APPROVED — DECISION RECORDED` =
> finalized in this closure task (D40, D42) and in the gap-resolution task (D41, presentation-only).

| ID | Topic | Evidence & constraints | Options | Recommended | Trade-offs | Status |
|---|---|---|---|---|---|---|
| FP11-D40 | Account landing: nav-oriented overview, supported-only | E7+E11+E12 (one profile call + one orders page); FP-11.1 conditional-section honesty; E8/G1–G4 unsupported set | (a) Overview (heading + identity + 3 shortcuts + 5-latest preview + default summary) with unsupported omitted + failed-vs-empty + logout-fidelity states (b) Feature-rich dashboard with invented data (rejected: fabrication) | (a) Practical nav overview per §7 (no fake forms/endpoints/metrics; logout reflects real outcome) | One extra fetch; calmer mobile | OWNER-APPROVED — DECISION RECORDED (2026-10-09) |
| FP11-D41 | Address list ordering | Server order unspecified; `isDefault` real (E11); FP-11.5 explicit-selection preserved | (a) Client default-first, then recency (display-only) (b) Raw server order (rejected: default buried) | (a) Default-first display | Display-only; zero contract impact | OWNER-APPROVED — DECISION RECORDED (this task; presentation-only, server order preserved, no page-only sorting) |
| FP11-D42 | Safe return navigation: centralized allowlist + double-gate + fallback | No backend redirect param; open-redirect/parse-confusion risk; checkout-login flow (FP-11.5 §4.2); framework router available | (a) Explicit allowlist (`/cart`, `/checkout`, `/account`, `/account/*`, `/`) + capture-time AND post-login revalidation + `/account` fallback + auth-route/external/encoded rejection + no-secrets-in-URL (b) Echo any `next` (rejected: open redirect) | (a) Centralized policy per §12 (preference, not authorization; Back/Forward preserved; no loops) | Tiny scope debate; secure default | OWNER-APPROVED — DECISION RECORDED (2026-10-09) |

409-duplicate messaging and no-default-assumption are backend-dictated VERIFIED behaviors, not owner
decisions — recorded in §§5/9, not as D-items.

## 19. Acceptance criteria

> Specification-level only. NONE executed. No pass claimed.

- AC-A1: login/register payloads, phone-ladder, 12–128 policy, 201+auto-session vs 200, 400/409/401 mappings per §§5–6.
- AC-A2: no OTP/reset/recovery/profile-edit/session-list UI rendered anywhere (§§9–10/§17).
- AC-A3: session taxonomy (expiry vs invalid vs logout vs offline vs 404-foreign) per §4; no transient logout.
- AC-A4: order history keyset + snapshot detail + foreign-404 + guest exclusion per §8.
- AC-A5: address CRUD + `isDefault` switch + 409 reselect + snapshot-immutability note per §9.
- AC-A6: password change revokes-all → mandatory re-login; logout current-only per §10.
- AC-A7: four-credential separation + no silent conversion + explicit-merge-only per §11.
- AC-A8: centralized `next` policy per §12 — valid internal destination navigated; missing →
  `/account`; external absolute, protocol-relative, backslash/encoded/malformed, auth-route loop, and
  post-login-unauthorized targets → fallback + independent authz enforcement; Back/Forward intact; no
  secrets in URL; no guest-checkout gate.
- AC-A9: full state matrix (§13) + mobile/RTL/a11y (§14) + brand tokens.
- AC-A10: zero-app-code (only FP-11.7 + FP-11.8 files per this two-phase task; no other files).
- AC-A11 (D40): every nav item maps to §§15/8/9/10 (§7); zero unsupported items rendered functional
  (§§7/10/17); identity from current-user 200 only; failed ≠ empty ≠ unauthorized (§§7/13); logout
  fidelity per §13 row; mobile/desktop RTL usable (§14).

## 20. Evidence-based final verdict

```text
SPECIFICATION COMPLETE — D40/D41/D42 OWNER-APPROVED
```

Every screen traces to §§3/15 or an explicit §§17 gap (G1–G4 BLOCKED/UNSUPPORTED, G6 noted absence;
G5 implemented+verified this task). D40 (supported-only nav overview), D41 (default-first display,
server order preserved, no page-only sorting) and D42 (centralized return policy) are finalized
above. No contract evidence is missing for any supported account capability. Implementation separately authorized.

---

*End of FP-11.7 — specification-only, no implementation.*
