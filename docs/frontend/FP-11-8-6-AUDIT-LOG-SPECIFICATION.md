# FP-11.8.6 — Admin Audit Log UX Specification

> Classification: `SUPPORTED` / `UNSUPPORTED` / `UNVERIFIED`. Specification-only. Audit rows are
> ADMIN-actor, same-transaction-paired records; the log is append-only and read-only from the UI.

## 1. Screen & fields (server-returned only)

- Row: id, `action` (`^[a-z0-9_]+\.[a-z0-9_]+$` CHECK shape, e.g. `orders.cancel`), `userId` (+ resolved
  admin name where the read contract joins it — display raw id when it doesn't), `actorType` (ADMIN),
  `entityType`/`entityId`, `oldValues`/`newValues` (JSON mirrors — rendered as readable diffs, never
  executed), `createdAt` ISO → localized. Result/outcome is read from the recorded values, not invented.
- Display ONLY rows/fields the read API returns for an event the backend actually wrote. No event is
  shown merely because the UI performed an action (pairing is server-side; customer self-service stays
  unaudited by frozen rule and simply never appears).

## 2. Reading & security rules

- Read-only: NO edit/delete/retry-mutation affordances (no mutation API — verified absence).
- Never render password hashes, raw tokens, session secrets, or equivalent credential material in
  details (verified by construction — serializers omit them; UI adds no "show raw" control).
- No audit row assumed per operation — coverage = mutation+audit-paired admin endpoints only.
- Server filters + keyset pages (`user/action/entity/dates` equality/range on indexed columns —
  NO full-text search; unknown filter values → 400, sanitize client-side).
- Empty (no rows for filter) ≠ load failure (distinct states, §FP-11.8.7); 403 (`audit_logs.view`
  missing) → forbidden state, not an empty log.

## 3. Acceptance criteria (DEFINED — NOT EXECUTED)

- Fields from contracted reads only; no UI-invented events; no customer-action rows expected.
- Read-only enforced in UI; secrets never rendered; coverage honestly scoped.
- Server filters + pagination; empty/failure/403 distinct. D45 visibility; Arabic RTL/a11y.

---

*End of FP-11.8.6 — specification-only.*
