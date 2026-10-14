# FP-15 — File Organization & Responsibility Boundaries

> Classification: `ADOPTED — TECHNICAL DEFAULT` (incremental, current-structure-first).
> Specification-only — no directories or files created. New boundaries appear only when the first
> work package needs them.

## 1. Current structure (verified, reused as-is)

- `src/app/` — App Router pages/layouts/route handlers; existing `(store)`/`admin` groupings kept;
  no new route groups mandated here. `src/app/actions/auth.ts` — sole Server Actions file (admin auth).
- `src/lib/` — server domain modules under `server-only` discipline + pure helpers; validation stays
  domain-colocated (`catalog/validation.ts` pattern).
- `src/app/admin/login/LoginForm.tsx` — sole Client Component; its form conventions reused.
- Absent (verified — fact, not gap): `components/`, `features/`, `types/`, `stores/`, `services/`,
  `tests/` directories.

## 2. Accepted target structure (lazy per work package)

- `src/components/ui/` — FP-12 primitives/composites at first need (WP-02).
  `src/components/{store,admin}/` only when a second consumer proves sharing (FP-12 third-use rule).
- `src/lib/storefront/` — PLANNED client-safe integration layer (FP-13); created only with its first
  real consumer; never imported by server-only modules; never presented as existing before then.
- Domain types stay with validation modules (no central `types/`). No `stores/` (no global store per
  FP-14 — contexts only on proven need). No `services/` layer (handlers + lib domains suffice).
- Tests: backend suites stay in `scripts/api/` (+ frozen `db/tests/`); future frontend tests colocate
  per the FP-16 tooling decision when execution is authorized (no layout mandated now).

## 3. Boundary rules

1. Pages/layouts/loading/error own routing + composition only. 2. Shared presentation in `components/`;
   feature components stay with their flow. 3. Data access in route handlers (server) or the planned
   `storefront/` layer (client-safe only). 4. Types/validation domain-colocated, never duplicated.
5. `server-only` modules never enter the client graph (build-enforced). 6. Abstractions extracted on
   3rd reuse only. 7. Tests colocated per §2; backend suites untouched. 8. Admin shell/pages reused in
   place. 9. No duplicate clients/stores/fetchers; single-flight + abort per FP-14. 10. New folders
   require a needing work package (this section is the gate).

## 4. Acceptance (DEFINED — NOT EXECUTED)

Any future agent can place pages/components/helpers/types/tests without repo-wide reorganization;
server/client violations structurally unlikely; no speculative scaffolding exists.

---

*End of FP-15 — specification-only, no implementation.*
