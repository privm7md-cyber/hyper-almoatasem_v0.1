# FP-15 — Interactive Prototype Report (MOCK — NO REAL OPERATIONS)

> Status: PROTOTYPE BUILT + EXECUTED (dev-server render verified). Classification of everything below:
> PROTOTYPE-ONLY unless cited as a locked contract it demonstrates. No backend/DB/d4099067-9fd9-4966-863f-dac4deaf9086est call exists in
> prototype code (grep-verified). No production flow touched.

## 1. Location & run

- Root: `/prototype` (isolated route subtree) + `src/prototype/` (mock data, client store, atoms, shared
  order views). 19 files, zero new dependencies (React/Next/Tailwind already present).
- Run: `npm run dev` (or `npm run build && npm start`), open `http://localhost:<port>/prototype`.
  Verified on port 3141 (dev): **19/19 routes HTTP 200** (home, 3 categories incl. empty + unknown,
  3 products + unknown, cart, checkout, confirmation, orders list + detail, admin login/dashboard/
  catalog/inventory/orders/orders-detail).
- Isolation rationale: path-isolation (not a separate app) — cheapest safe option: shared root layout
  untouched, zero imports from `@/lib`, zero `fetch`, zero storage APIs (grep-verified); production
  `/` and `/admin/*` routes/files unmodified (status shows no M on them).
- Banner: every screen shows `INTERACTIVE PROTOTYPE — MOCK DATA — NO REAL OPERATIONS` (verified in
  served HTML) + Arabic subtitle; `dir="rtl"` set by prototype layout (verified). Root `<html lang="en">`
  is shared boilerplate (known limitation — documented, not changed in this task).

## 2. Flows implemented

Customer: Home (sections + demo-state toggles + reset) → Category (incl. empty + unknown) → Product
(PIECE p-rice with compare-at reference + promo badge labeled scenario-fiction; WEIGHT p-romi with step-250
presets + custom grams + step validation + estimate disclaimer; OOS p-sugar with disabled CTA) → Cart
(add/set/remove/clear, mixed units, mock totals labeled non-authoritative) → Checkout (guest, no account;
phone/city validation; mock 20.00 fee; invalid-field + simulated-error toggles; back-to-cart preserves draft)
→ Confirmation (mock HM-000123, no live tracking claim) → Order detail (status Arabic, requested 1250g vs
actual 1180g, totals mock) → Replacement (PROPOSED approve/reject mutate mock state; decided state + reset).
Admin: login (any-input success / empty fail / pending / error) → dashboard (labeled mock indicators + gate
when logged out) → catalog (list + empty toggle) → inventory (mock adjust + invalid-value check + reset;
PIECE/WEIGHT distinguished) → orders (list) → order detail (allowed mock act + simulated-403 demo).

## 3. Scenarios (16) & activation

Sidebar switcher links: happy-path chain, OOS, piece, weight, promo, empty-cart (via clear), bad-checkout
(invalid phone/city), checkout-error (toggle), loading (home toggle), error/empty (home toggles), open order,
replacement approve, replacement reject (= no-substitute outcome shown as short), admin ok/fail, catalog empty,
forbidden admin act. Reset: per-scenario reset buttons + global reset (mock state only; reload also resets).

## 4. Executed verification (this task)

- `tsc --noEmit`: CLEAN (one prototype narrowing fix applied; one transient pre-existing `.next` generated-
  types corruption cleared per repo precedent — gitignored cache only; `layout.tsx` untouched).
- `eslint src/prototype src/app/prototype`: CLEAN (one `window.location` warning fixed via `useRouter`).
- `npm run build`: PASS, 14 prototype routes compiled (static + dynamic listed in output).
- Dev-server render: 19/19 HTTP 200 on port 3141 (no `/api/*` touched; no DB writes possible — no code path).
- Isolation grep: zero `fetch(|@/lib|prisma|localStorage` hits in prototype code.
- Server stopped afterwards (Node 0). No browser tooling in repo (no playwright/puppeteer — verified
  absence) → no viewport/screenshot/interaction testing executed; review §FP-16 states this limit.

## 5. Known limitations (PROTOTYPE-ONLY unless noted)

Mock totals/badges/fees/IDs/statuses are fiction; step/validation mirrors contracts but proves nothing about
backend; root lang stays "en"; no viewport testing performed here; admin gate is a boolean (not RBAC);
order list shows one demo order; no persistence (reload resets); no offline/PWA behavior.

## 6. Files created (no file modified)

`src/prototype/{mock.ts,store.tsx,ui.tsx,order-shared.tsx}` + `src/app/prototype/{layout,page,cart,checkout,
category/[id],product/[id],confirmation/[id],orders/page,orders/[id],admin/page,admin/login,
admin/catalog,admin/inventory,admin/orders/page,admin/orders/[id]}` pages (19 files).

## 7. Unresolved by docs

None blocking the prototype: open owner items (font/icons/neutrals/logo/CMS/assets) are rendered via locked
fallbacks (system font stack, text labels, neutral placeholders) and stay OPEN in their own registers.

---

*End of FP-15 report — prototype executed as above; production readiness NOT claimed.*
