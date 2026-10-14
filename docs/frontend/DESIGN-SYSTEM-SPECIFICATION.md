# Design System Specification — Foundations, Components & Behavior Rules

> **Naming note (collision resolved):** repo `FP-09` is Information Architecture
> (`FP-09-INFORMATION-ARCHITECTURE.md`, LOCKED D01–D12 — untouched and still authoritative for IA;
> see also FP-10 §25). This file covers the task-ordered "FP-09 Design System" scope under a
> non-colliding name. It does NOT rename any phase. References below say "this spec" or "DS".
> **Method:** REUSE FP-10 (foundations) + FP-12 (component inventory) as normative sources; ADD only the
> tokens/components missing from both; never redefine. No code/tokens files/deps. Static review only.

## 1. Feature coverage matrix (DS scope)

| ID | Requested feature | Existing spec | Coverage | Evidence | Action | Final status |
|---|---|---|---|---|---|---|
| DS-F01 | Color/type/spacing/radius/shadow/breakpoint tokens | FP-10 §§4–13 + FP-12 §8 | COMPLETE | Values verified identical | REUSE | CLOSED |
| DS-F02 | z-index/opacity/motion-scale/surface-levels | FP-10 §20 (partial: ≤200ms, reduced-motion) | PARTIAL | No full scales found | EXTEND (§2) | CLOSED |
| DS-F03 | Primitives/forms (button/inputs/stepper/filter/sort/pagination) | FP-12 §§3–6 + FP-10 §§14–15 | COMPLETE | 14-field contracts | REUSE | CLOSED |
| DS-F04 | Feedback/overlay (badge/toast/alert/modal/drawer/sheet/dialog/skeleton/...) | FP-12 §7 + FP-10 §17 | PARTIAL (shells thin) | Shared set exists | EXTEND (§3: Tabs/Accordion/Modal/Drawer/Sheet/Tooltip/Toast-map/Progress) | CLOSED |
| DS-F05 | Navigation/disclosure (tabs/breadcrumb/dropdown/carousel/bottom-nav) | FP-12 §3 + FP-03 | PARTIAL | BottomNav/Breadcrumbs exist | EXTEND (§3) | CLOSED |
| DS-F06 | Layout/data (card/table/timeline/avatar/gallery/uploader) | FP-12 §§3–6 | PARTIAL (timeline/gallery/uploader/avatar missing) | Inventory checked | ADD (§3: Gallery, DateInput, FileUploader-boundary, Category/Brand cards, Timeline) + DEFER (Avatar, Combobox, Popover, Carousel) | CLOSED |
| DS-F07 | Commerce (cards/price/discount/stock/variant/gallery/promo) | FP-12 §4 + FP-10 §16 + FP-05 | COMPLETE | Contracts exist | REUSE | CLOSED |
| DS-F08 | State matrix + behavior/commerce rules | FP-12 §§7/11 + FP-10 §§17/20 | PARTIAL (per-new-component states) | — | EXTEND (§4 + §5) | CLOSED |
| DS-F09 | Responsive/RTL/a11y contract | FP-10 §§9/12/20 + FP-12 | COMPLETE | Rules exist | REUSE | CLOSED |

## 2. Added tokens (namespace `ds-*`; FP-10 tokens untouched and authoritative on overlap)

| Token | Value | Use | Status |
|---|---|---|---|
| `ds-z-base:0` · `sticky:10` · `drawer:40` · `dialog:50` · `toast:60` | Ordered layers | Overlap discipline (sticky<drawer<dialog<toast) | SELECTED (reviewable) |
| `ds-opacity-disabled:.55` · `scrim:.5` (matches FP-10 scrim) · `skeleton-shimmer` (non-motion-safe alternative: static pulse-off) | Disabled/scrim/loading | Never sole cue (FP-10 rule kept) | SELECTED |
| `ds-motion-instant:0` · `micro:120ms` · `short:200ms` (FP-10 cap kept) · `ease-out: cubic-bezier(.2,0,0,1)` | Micro-transitions only | Data-dense lists: motion OFF; reduced-motion: all non-essential OFF | SELECTED |
| `ds-surface-0:page` · `1:card` · `2:raised(dialog/drawer)` · `3:sticky-bar` (all map to FP-10 surface hexes) | Elevation levels | Shadow pairs per FP-10 §13 | SELECTED |

Pending-approval FP-10 items (font D01/D02, neutrals D06, icons D12) are consumed as open choices, never decided here.

## 3. Added component specs (behavior-first; FP-12 contracts referenced, not copied)

**Tabs** (admin detail/prep tabs): roving-tabindex, arrow-key nav, `aria-selected`, panels labelled; content per
FP-11.8 sections; mobile → scrollable tablist (no wrapping chaos). **Accordion** (category drill-down, mobile
menus, filter groups): native button+region, Esc collapses, one-open policy per group (UX-PROPOSAL). **Modal /
Drawer / BottomSheet** shells (FP-10 §17 behavior binding): focus trap + Esc + scrim-dismiss (destructive-confirm
excepted), return-focus, sheet = mobile pattern for filters/dialogs. **Tooltip**: label-supplement only, never sole
carrier for money/critical actions; keyboard-focusable trigger; Esc dismiss. **Toast**: transient SuccessMessage
variant (post-200/201 only, auto-dismiss + persistent log link for critical outcomes — never hides results).
**Progress**: determinate only with real fraction; else LoadingState (no fake percent). **Timeline**: order-history
rendering (FP06-D02 advisory presentations both satisfy; newest-first, state dots + timestamps from reads).
**Date/Time Input**: text-first with native date fallback for admin filters (status/customer/date per §FP-06 7b);
validates shape only, never business meaning. **Gallery**: primary-first + lazy thumbs + keyboard arrows + RTL
order + single-image NO-gallery rule + broken fallback (FP-07 §3 binding). **FileUploader (boundary-only)**:
empty/selected/uploading/success/error/disabled/keyboard/a11y/mobile states as pure design; NO product-upload flow
documented as supported (no endpoint — backend boundary explicit). **Category/Brand Cards**: ProductCard-derived
(image/name/children-count-from-listed-data only; no invented counts), same fallback/a11y rules.
DEFERRED (no backend/use-case): Avatar, Combobox (no autocomplete API), Popover (use Tooltip/Dialog), Carousel
(minimal-carousel policy — no nav component built).

## 4. State matrix additions (for §3 components; FP-12 matrix kept for the rest)

Default/Hover/Focus/Active/Selected/Disabled/Loading/Error/Empty/Mobile/RTL/Keyboard/a11y/Animation/Usage-rules
per component above; N/A justified inline (e.g. Progress: no Empty; Tooltip: no Loading; Timeline: no Disabled).
Misuse bans: color-only status; icon-only money/critical acts; pre-confirm success toasts; fake progress; draft-save
implications; auto-act on scan/select.

## 5. Behavior rules (commerce/ops binding — FP-03…FP-06 meanings preserved)

Card shows OOS (never hides) · price splits Estimated vs Confirmed · WeightSelector step-gated · StockBadge needs
data · Toast post-confirm only · StatusIndicator creates no state · Table surfaces 403/conflict · Uploader implies
no API · Modal never blankets every action · Timeline never invents events · Gallery never fakes images.

## 6. Integration map (FP-10 → this spec → FP-12; single source per decision)

Foundations FP-10 §§4–13 → tokens §2 → components FP-12 §§3–7 + §3 here → screens FP-03/FP-11.x → state FP-14 →
tests FP-16. No component defines color/type outside FP-10; no screen invents states outside FP-11.x/FP-14.

## 7. Acceptance (DEFINED — NOT EXECUTED)

Coverage matrix (§1) · added tokens with roles (§2) · added components behavior-first (§3) · states (§4) ·
binding rules (§5) · integration map (§6) · zero FP-10/FP-12 redefinition · zero backend/asset claims ·
IA file untouched.

---

*End of Design System Specification — specification-only, no implementation.*
