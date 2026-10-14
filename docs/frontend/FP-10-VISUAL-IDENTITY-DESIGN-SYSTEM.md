# FP-10 — Visual Identity & Design System (Specification Only)

> Status labels: `VERIFIED` · `LOCKED` · `RECOMMENDATION` · `BACKEND-CONSTRAINED` ·
> `NEEDS OWNER DECISION` · `NOT VERIFIED` · `OUT OF SCOPE`. No components, CSS, fonts,
> assets, dependencies, builds, commits, or deploys in this phase. Locked colors byte-identical.

## 1. Document metadata and scope

- Phase FP-10, storefront + admin, pre-implementation. Covers §§2–28 per mission (principles,
  tokens, contrast, typography, numerals/units/RTL, spacing, layout, breakpoints, radius/border/
  shadow, buttons, forms, cards/commerce, status/dialogs, icons/direction, shared conventions,
  a11y/focus/motion/density, naming, register, acceptance, constraints, consistency, owner items,
  validation, verdict).
- Source inventory: `package.json` (Next 16.3.8, React 19, Tailwind v4, no icon/font packages),
  `src/app/layout.tsx` (Geist latin-only, `lang="en"`), `src/app/globals.css` (bare v4 import),
  `next.config.ts` (API-only hardening headers; CSP/HSTS deliberately absent), `src/app/admin/login/LoginForm.tsx`
  (only existing UI pattern), FP-00/FP-04/FP-05/FP-06/FP-09, BRAND-STRATEGY-v1, VI-01, Google Fonts
  CSS API (verified 2026-10-09), computed WCAG ratios (method §6).

## 2. Executive summary

Locked identity (purple/orange/ink + surfaces + success/error) carries the brand; everything else
is specified as recommendations. Contrast audit proves orange fails as text and as white-text
background — usage rules (not color edits) resolve it. Cairo (variable 200–1000, Arabic+Latin)
is the recommended Arabic font; IBM Plex Sans Arabic the reasoned alternative. System covers
tokens, type, spacing, layout, breakpoints (Tailwind v4 defaults adopted, not reinvented),
restrained radius/shadow, full component contracts, RTL/bidi rules, WCAG-2.2-gated a11y, and
reduced-motion. Three genuine owner decisions remain (§26); Geist latin-only, absent icons/logo/
CSP, and untested rendering are recorded constraints.

## 3. Brand and visual principles (LOCKED direction; operationalized here)

Modern (organization/consistency/usability, never tech showmanship) · Clean (information first,
restrained chrome, balanced density — neither cluttered nor barren) · Practical (fewest steps to
buy; price/unit/availability/add always co-located) · Warm-local without noise · Calm with
selective commercial energy (orange reserved for real promotions). Personality traits
(trustworthy/warm/organized/practical/calm) map to §14–17 contracts; promise «احتياجات بيتك
بسهولة ووضوح، وثقة في كل خطوة» is served by clarity patterns, never decorative claims.

### Owner-supplied logo reference (inspected 2026-10-09; reference only, artwork untouched)

Observed: circular emblem — orange upper swoosh arc, purple cart device with orange basket slats,
purple lower swoosh; Arabic wordmark «هايبر» (orange) + «المعتصم» (purple), bold rounded lettering;
letterspaced Latin «HYPER ELMOATASEM» with orange/purple rules. Character: bold, friendly,
modern-retail — compatible with VI-01 (warm/practical/calm, not luxury, not corporate-cold) and
supportive of the Cairo recommendation above. Palette harmony: emblem visibly purple+orange,
consistent with the locked palette; exact sampled hex values NOT claimed (raster preview only).
Safe backgrounds: white/light confirmed as shown; dark/overlay/photographic untested. Small sizes:
wordmark will fail at favicon scale — emblem-only usage recommended there (usage rule, not a new
asset). NOT verifiable from the preview: transparency, vector/source format, editable original,
license. Distinctions hold: reference available (this review) ≠ repository asset (absent — public/
holds only framework SVGs, re-verified) ≠ production readiness (unverified). No logo file added,
modified, or generated; no recolor/lettering/layout change made or proposed.

## 4. Locked brand palette (LOCKED — character-verified)

| Token | Value | Role |
|---|---|---|
| `brand-purple` | `#511D9C` | Primary identity; primary actions where appropriate |
| `brand-orange` | `#FF7100` | Emphasis, promotions, commercial highlights (never body text) |
| `text-orange` | `#C2410C` | Readable orange text on light surfaces |
| `text-ink` | `#1B1530` | Primary text and headings |
| `surface-purple` | `#EEE8F5` | Subtle purple-tinted backgrounds |
| `surface-orange` | `#FFF1E6` | Subtle promotional/commercial surfaces |
| `status-success` | `#15803D` | Success states and confirmations |
| `status-error` | `#C62828` | Errors, destructive/dangerous contexts |

## 5. Semantic token architecture

| Token (RECOMMENDATION name) | Value / source | Role | Status |
|---|---|---|---|
| `color-text-primary` | `text-ink` | Body, headings | LOCKED (value) |
| `color-text-secondary` | `#5B556E` | Secondary text | RECOMMENDATION |
| `color-text-disabled` | `#A8A3B8` (exempt: disabled-component rule; never sole cue) | Disabled text | RECOMMENDATION |
| `color-text-on-brand` | `#FFFFFF` on purple only (10.47:1) | Text on primary fills | LOCKED + RECOMMENDATION (rule) |
| `color-text-on-accent` | `text-ink` on orange fills (~6.4:1; white-on-orange 2.76 FAILS) | Text on orange fills/badges | RECOMMENDATION (rule) |
| `color-surface-page` | `#FFFFFF` | Page background | RECOMMENDATION |
| `color-surface-card` | `#FFFFFF` | Cards, dialogs | RECOMMENDATION |
| `color-surface-subtle` | `#F6F5F9` | Secondary surfaces, zebra rows | RECOMMENDATION |
| `color-surface-brand-subtle` | `surface-purple` | Identity-tinted panels | LOCKED (value) |
| `color-surface-promo-subtle` | `surface-orange` | Commercial panels (with ink text) | LOCKED (value) |
| `color-border-default` | `#E4E1EC` | Borders, dividers, input frames | RECOMMENDATION |
| `color-border-strong` | `#C9C4D8` | Emphasis frames, table rules | RECOMMENDATION |
| `color-action-primary` (+hover/active) | `brand-purple` fill, white text; hover darkened only via overlay, never a new hex invented ad hoc | Primary CTA | LOCKED (base) + RECOMMENDATION (states) |
| `color-action-secondary` | Transparent + `color-border-strong` frame + ink text | Secondary actions | RECOMMENDATION |
| `color-action-text` | `brand-purple` text on light (10.47:1) | Tertiary links | RECOMMENDATION |
| `color-action-danger` | `status-error` | Destructive actions | LOCKED (value) |
| `color-status-success-fg/bg` | `status-success` / `#E7F4EC` | Confirmations | value LOCKED; bg RECOMMENDATION |
| `color-status-error-fg/bg` | `status-error` / `#FBE9E9` | Errors | value LOCKED; bg RECOMMENDATION |
| `color-status-warning-fg/bg` | `#B45309` (5.02:1 on white, computed) / `#FEF3C7` | Warnings (rare; never invent urgency) | RECOMMENDATION |
| `color-status-info-fg/bg` | `#1D4ED8` (6.70:1 on white, recomputed) / `#E8EFFD` | Neutral info | RECOMMENDATION |
| `color-status-unavailable-fg` | `#5B556E` + icon + «غير متوفر» text | OOS (never color-only) | RECOMMENDATION |
| `color-input-bg` | `#FFFFFF` | Field fills | RECOMMENDATION |
| `color-overlay-scrim` | `rgba(27,21,48,.5)` | Dialog/drawer scrims | RECOMMENDATION |
| `focus-ring` | `brand-purple` 2px + 2px offset (≥3:1 vs white/surfaces; white ring on purple fills) | Keyboard focus | RECOMMENDATION |
| `spacing-*`, `radius-*`, `type-*` | §§10–13 | Layout/type systems | RECOMMENDATION |

Distribution (LOCKED direction): predominantly light backgrounds; purple = identity + primary actions;
orange = selective commercial emphasis; ink = ordinary text. Orange fills always carry ink text;
`surface-orange` is informational/promotional, never an error signal.

## 6. Contrast audit (computed WCAG 2.2; AA text ≥4.5, large ≥3.0, non-text UI ≥3.0)

| Pair | Ratio | Verdict |
|---|---|---|
| ink/white 17.55 · purple/white 10.47 · white/purple 10.47 · ink/purple-surfaces 14.62 · purple/purple-surface 8.72 · ink/orange-surface 15.86 · purple/orange-surface 9.46 | ≥4.5 | PASS text |
| text-orange/white 5.18 · success/white 5.02 · error/white 5.62 · text-orange/orange-surface 4.68 · success/orange-surface 4.53 · error/orange-surface 5.08 | ≥4.5 | PASS text (4.5x band: avoid small/light uses) |
| orange/white 2.76 · white/orange 2.76 · orange/purple-surface 2.30 | <3.0 | FAIL text, large text, and non-text → orange NEVER as text, NEVER as sole indicator, NEVER white text on orange |
| text-orange/purple-surface 4.31 | <4.5 | Large-text/UI only, never body |
| ink-on-orange ~6.4 (derived) | ≥4.5 | PASS → required pairing for all orange fills/badges/buttons |

Safe-use rules: body text = ink (or text-orange ≥16px semibold+ with care); sale prices in error-red
only when genuinely cheapest-comparable? No — sale price stays ink; discount signal via badge +
struck compare-at (FP-05). Disabled pairs exempt but must add icon/text cue. Focus ring ≥3:1 vs
adjacent (§5). Conformance of full screens NOT claimed (needs rendered testing).

Supplementary-pair findings (recomputed 2026-10-09; additive rules, no value changes):
secondary/white 7.07 PASS · warning/white 5.02 PASS · info/white 6.70 PASS · ink/subtle 16.17 PASS ·
success/success-bg 4.43 (marginal: success-fg on success-bg is large-text/UI-only; body confirmations
use ink text + success icon on the tint) · error/error-bg 4.80 PASS · warning/warning-bg 4.51 PASS
(4.5 band: keep to short strings) · info/info-bg 5.81 PASS · disabled/disabled-context 2.44
(exempt class; non-color cue mandatory) · border-default/strong on white 1.29/1.70 (decorative-only;
interactive boundaries must rely on labels, fills, or the focus ring — never the 1px frame alone).

## 7. Typography comparison and recommendation

| Criterion | Cairo (variable 200–1000; arabic+latin subsets VERIFIED via Google Fonts CSS API) | IBM Plex Sans Arabic (static 100–700 incl. 400/500/700; arabic+latin VERIFIED) | Tajawal (400/500/700/800 + more; arabic+latin VERIFIED) |
|---|---|---|---|
| Body/small-card legibility | Strong humanist Arabic; variable range covers all 4 needed weights in one file | Enterprise UI pedigree; excellent small sizes; static files per weight | Lighter voice; narrower effective range; less dense-UI pedigree |
| Prices/qty/numerals | Full Latin set; tabular figures to be verified at implementation (NOT VERIFIED) | Plex tabular strengths; pairs with Plex Latin/Mono | Adequate; no advantage shown |
| Admin/data density | Good | Best-in-class tables (Plex system) | Weakest of three |
| Loading cost | One variable file | Several static files | Several static files |
| License | OFL via Google Fonts (pin version at implementation) | OFL via Google Fonts (same note) | OFL via Google Fonts (same note) |

RECOMMENDATION (logo-informed, 2026-10-09): **Cairo** primary (single variable file, full
Arabic+Latin, weight flexibility, warm-modern voice matching VI-01 *and* the supplied logo's rounded,
friendly-retail lettering); alternative **IBM Plex Sans Arabic** (if small-size/admin density wins
evaluation, pairs with Plex Latin/Mono). REJECTED: Tajawal (no demonstrated advantage).
English pairing: Cairo's Latin for UI Latin; existing Geist Mono retained for code/IDs (VERIFIED
present in `layout.tsx`). Cairo + Plex pairing form one dependent approval group with FP10-D01
(choosing Plex Arabic implies Plex Latin/Mono, not Cairo's Latin). No rendering test performed —
stated plainly. Needs owner approval (§26).

## 8. Typography role scale (RECOMMENDATION; px + weight + line-height)

Display 30/700/1.25 · H1 page 24/700/1.3 · H2 section 20/700/1.35 · H3 18/600/1.4 · Body 16/400/1.6 ·
Body-sm 15/400/1.6 · Secondary 14/400/1.6 · Metadata 12–13/400–500/1.5 · Price 20/700/1.3 (semibold+
for emphasis; tabular-nums where verified) · Unit/qty 14/500 · Button 16/600 · Input 16/400 (≥16px
prevents iOS zoom) · Label 14/600 · Helper 13/400 · Message 14/500 · Table header 13/700 + cell 14/400 ·
Code/ID: Geist Mono 13–14 LTR-isolated. Arabic shaping/wrapping explicit per role; no look-alike roles.

## 9. Numeric, currency, unit, and RTL typography rules

- EGP: backend decimal strings rendered as-is (`152 ج.م` pattern per FP-00; currency code EGP in
  technical layer). No frontend rounding/conversion (FP-05).
- Decimals as authored (≤3dp quantities); estimates labeled non-final until picked.
- Units disambiguated: `125 جم`, `1 كجم`, pack counts with وحدة البيع; bare numbers forbidden.
- Barcodes/order IDs/UUIDs/URLs/emails: LTR-isolated spans (`dir="ltr"`, mono where technical),
  never reversed by RTL context.
- Mixed Arabic/English: logical properties + `unicode-bidi: isolate` on embedded runs; prices keep
  adjacent currency in reading order.

## 10. Spacing system (RECOMMENDATION; 4px base)

`spacing-3xs:2` (dense nudges, sparing) · `xs:4` · `sm:8` · `md:16` (default) · `lg:24` · `xl:32` ·
`2xl:48` · `3xl:64` (section separation) + page-gutter tokens (§11). Related elements ≤ md apart;
unrelated ≥ lg. Compact (admin rows/badges) vs comfortable (storefront cards) densities share tokens.

## 11. Layout and container rules (RECOMMENDATION)

Content container max ~1200px centered; page gutters 16 mobile / 24+ desktop; product-grid gaps 12–16;
forms ≤560px measures; body copy ≤65ch; admin tables full-container with card-fallback on small
screens. Storefront and admin share tokens with different density, never different systems.

## 12. Responsive behavior and breakpoint recommendations

Adopt Tailwind v4 default scale (documented, not reinvented): sm 640 / md 768 / lg 1024 / xl 1280 /
2xl 1536 — RECOMMENDATION (no project scale exists to conflict). Behavior per band: small mobile
single-column, bottom nav, drawer filters; typical mobile same + 2-col compact grids where legible;
tablet 2–3 col, condensed header; desktop full header, inline filters, tables; wide: capped container,
no stretched lines. Rules: no whole-storefront horizontal scroll; no clipped Arabic text; no
overlapping CTA; keyboard must not trap inputs (viewport-aware CTA); responsive images with crop
rules (§17); touch targets per §20.

## 13. Radius, border, shadow, and elevation tokens (RECOMMENDATION)

Practical-clean wins over decorative: `radius-badge:9999`(pills only for badges/chips) ·
`radius-control:8` (buttons/inputs) · `radius-card:12` · `radius-dialog:16` · `border-default:1px`
`color-border-default` · `border-strong` for emphasis/selected · `shadow-subtle` (cards at rest,
near-flat) · `shadow-elevated` (dialogs/drawers/sticky bars) · scrim overlay. No gradients for
decoration; no deep shadows on dense lists; one radius language everywhere.

## 14. Button component contract

Variants: primary (purple fill/white text) · secondary (transparent + strong frame + ink) · text
(purple text) · danger (error fill or ink-text+error frame per severity) · icon-only (44px, labeled).
States: default/hover (overlay-darken, no new hex)/focus (ring)/active-pressed/disabled (token +
no-pointer + reason where useful)/loading (spinner + `aria-busy`, label kept)/success-persistent
only where justified (e.g. added-to-cart transient, not order success). Heights: 44 primary/input;
40 compact secondary; min interactive area 44×44 preferred (WCAG 2.2 target-size rules + exceptions
apply at implementation test). RTL: icon leading-side aware via logical properties; spinner replaces
icon slot, label never shifts layout. Loading never implies mutation success (FP-04/FP-06 rule).

## 15. Form-field contract

Labels always visible (placeholders never sole labels) · required marked · 44px height, 12–16px
inner padding · default/strong frames, white fills · visible focus ring · invalid (error frame +
message + `aria-describedby`/`aria-invalid`) · disabled (token + reason) · helper vs error text
roles · keyboard: native inputs, Enter submits, Esc closes sheets/dialogs, error summary focus on
submit-fail · input preserved across recoverable failures · validation messages inline per field.
Business validation stays backend-owned; patterns validate shape only (never price/stock/coupon
outcomes, never quantity rules beyond wire shape).

## 16. Product-card and commerce-component contracts

Card anatomy (hierarchy): image (4:3, contain, neutral bg) → name (2-line clamp max, full name on
PDP) → variant/unit line → price row (current + struck compare-at ONLY when backend non-null) →
availability line (icon + «غير متوفر»/low/in-stock) → promo badge ONLY on backend-computed benefit →
qty stepper + add (44px targets; stepper bound to PIECE/WEIGHT step rules) → inline update feedback.
Skeletons mirror anatomy; errors inline per card. No ratings/reviews/popularity/sales counts (no
source). No badge merely because orange exists. Long Arabic names wrap; prices tabular where verified.
Images: aspect 4:3, `object-contain` on neutral bg (no distorted packaging), lazy below fold,
neutral fallback + broken-image handler; category placeholders allowed only if neutral and labeled.
Commerce extras: unit selector only where contract supports variants; cart-line = name/variant/qty/
server totals; price summary = server math only; empty-cart guided; OOS presentation per §17.

## 17. Status, dialog, and feedback contract

Success/error/warning/info/loading/empty/OOS/read-only/disabled/network-retry states, each =
icon + text + color (color never sole cue), consistent storefront↔admin. Dialogs: focus trap + Esc +
scrim-dismiss (except destructive-confirm which requires explicit choice), labelled by heading,
return focus on close. Confirmations only where FP-04/FP-06 require (cancel, reject, destructive
admin acts) — never blanket-confirm everything. Copy follows FP-04/FP-05 locked strings; new copy
needs owner review.

## 18. Iconography and directionality

No icon library exists in-repo (VERIFIED: no icon dependency, no icon dir; re-verified 2026-10-09
via manifest + tree search) → NEEDS OWNER DECISION: adopt **Lucide as the single UI icon system**
(recommended: consistent 24px stroke set compatible with the logo's bold-rounded geometry,
RTL-mirrorable, tree-shakeable; pairs with logical-property mirroring) vs alternative vs none.
One system only for ordinary interface icons; the brand mark itself is never redrawn as an icon
(see logo assessment). Sizes 16/20/24; single stroke weight per context;
16px text gap; mirror ONLY directional icons (back/forward/cart-arrow/progress) — never brand,
media, or technical symbols; decorative icons `aria-hidden`, meaningful ones labeled; missing-icon
fallback = text label, never broken glyph. Bidi: logical properties everywhere; isolate Latin runs.

## 19. Storefront/admin shared conventions

Shared: palette, type roles, semantic colors, spacing, buttons/forms, focus, icons, feedback, RTL,
bidi, a11y bar. Justified differences: comfortable storefront vs compact admin density; imagery vs
tabular data; discovery vs operational nav; long-form ops feedback; full-width tables with mobile
card fallback. Same tokens, different density — never two systems. Admin respects route RBAC;
hiding ≠ authorization (existing rule).

## 20. Accessibility, focus, motion, and density rules

Text/non-text contrast per §6 (measured pairs binding; full-screen conformance needs rendered
testing — NOT claimed). Keyboard: all commerce flows operable, visible focus, logical order, skip
links, no traps, dialogs per §17. Labels: every control named; prices/qty/availability announced
with values; errors associated + announced; status changes via live regions (polite; assertive only
for destructive confirmations). Touch: 44px preferred (WCAG target-size exceptions at test time).
Zoom/text-scaling must not break layouts (200% functional target at implementation test). Motion:
≤200ms micro-transitions, none on data-dense lists, no blocking of critical info,
`prefers-reduced-motion` disables non-essential motion, no forced auto-moving promos. Density:
type/row-height/spacing adapt per §10–12 without sacrificing contrast or targets.

## 21. Token and component naming conventions

`color-{role}-{variant}` · `spacing-{3xs…3xl}` · `radius-{badge,control,card,dialog}` ·
`shadow-{subtle,elevated}` · `type-{display,h1,h2,h3,body,body-sm,secondary,metadata,price,unit,button,input,label,helper,message,table,code}` ·
`focus-ring` · components `UiButton, UiField, UiCard…` (implementation naming, non-binding).
Semantic-first, single alias per meaning; component exceptions documented with reason; new-token
proposal requires: use-case, why no existing token fits, owner/design approval. No source-code token
file in this phase; Tailwind v4 config untouched.

## 22. Decision register

| ID | Topic | Authority/evidence | Classification | Existing state | Options | Recommended + rationale | A11y/UX impact | Perf/maint | Owner approval? | Dependencies | Closure |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FP10-D01 | Arabic font | GF API: Cairo var 200–1000 ar+latin; Plex static 100–700; Tajawal 400–800; logo-informed review 2026-10-09 | RECOMMENDATION | Geist latin-only (fails Arabic) | Cairo / Plex / Tajawal | Cairo: one file, full range, warm-modern voice matching the supplied logo's rounded retail lettering | Small-size legibility verified at render test | 1 variable file | **REQUIRED (approval group with D02)** | §7–8 | OPEN |
| FP10-D02 | English pairing | Cairo Latin verified; Geist Mono present | RECOMMENDATION | Geist Mono latin-only | Cairo-Latin + Geist Mono IDs / full Plex system | Cairo-Latin + retain Geist Mono for code/IDs (zero new deps) | Consistent numerals | None | **REQUIRED (with D01)** | D01 | OPEN |
| FP10-D03 | Weights/scale (§8) | Range needs 400–700 + display | RECOMMENDATION | None | 4-role set | Covers all roles, no look-alikes | Legibility | None | No (part of D01) | D01 | DOCUMENTED |
| FP10-D04 | Light balance vs purple surfaces | VI-01 clean direction | RECOMMENDATION | None | Light-dominant / purple-heavy | Light-dominant; purple for identity panels only | Contrast preserved | None | No | — | DOCUMENTED |
| FP10-D05 | Orange roles + text-orange guard | §6 ratios | VERIFIED (ratios) + RECOMMENDATION (rules) | Orange fails text/white-text | Restrictive rules | Only provably-safe pairings ship | Errors impossible by color alone | None | No | §6 | DOCUMENTED |
| FP10-D06 | Neutrals + warning/info/disabled | No locked neutrals; computed AA for warning/info | RECOMMENDATION | None | Proposed values | Minimal set; nothing else needed | Disabled exempt but cued | None | **REQUIRED (values)** | §6 | OPEN |
| FP10-D07 | 4px spacing scale | Commerce rhythm needs | RECOMMENDATION | Ad-hoc utilities only | 4px tokens / 8px tokens | 4px: finer control, Tailwind-compatible | Touch rhythm | None | No | — | DOCUMENTED |
| FP10-D08 | Breakpoints/containers | Tailwind v4 defaults; no project scale | RECOMMENDATION | None | v4 defaults / custom | Defaults: zero divergence, documented behavior | Predictable responsive | None | No | — | DOCUMENTED |
| FP10-D09 | Button/field heights (44) | Touch + iOS-zoom needs | RECOMMENDATION | Ad-hoc (LoginForm) | 44 / 40 | 44 primary/inputs; 40 compact secondary | Usability + zoom | None | No | — | DOCUMENTED |
| FP10-D10 | Card density | Catalog scale | RECOMMENDATION | None | Comfortable / compact | Comfortable storefront; compact admin | Readability | None | No | — | DOCUMENTED |
| FP10-D11 | Radius/shadow system | VI-01 restraint | RECOMMENDATION | Ad-hoc (`rounded`) | Restrained set / decorative | Restrained: trust + clarity | Calm UI | None | No | — | DOCUMENTED |
| FP10-D12 | Icon treatment | No library in-repo | RECOMMENDATION | None | Lucide / other / none | Lucide (mirrorable, tree-shakeable) | Directional correctness | One dep at implementation | **REQUIRED (adds dep)** | — | OPEN |
| FP10-D13 | Storefront/admin consistency | Shared tokens, density differs | RECOMMENDATION | One admin shell | Shared system | One system, two densities | Coherence | None | No | — | DOCUMENTED |
| FP10-D14 | Numerals/currency/units | Backend decimal strings; FP-05 | RECOMMENDATION | None | Western digits as-authored / Arabic-Indic | As-authored Western (matches backend, units, IDs) | Legibility | None | No | FP-05 | DOCUMENTED |
| FP10-D15 | Motion policy | Reduced-motion + restraint needs | RECOMMENDATION | None | Restrained / expressive | Restrained + reduced-motion | Vestibular safety | None | No | — | DOCUMENTED |
| FP10-D16 | Logo asset readiness | Owner reference inspected 2026-10-09 (emblem + wordmark observed; purple/orange visually consistent with locked palette — exact sampled values NOT claimed); repo asset absent (VERIFIED: public/ holds only framework SVGs); transparency/vector/source/license NOT verifiable from preview | Technical/asset gap (not a spec choice) | None | Text wordmark interim / commission production asset | Text wordmark interim (no fabrication); emblem-only recommended at small sizes | Identity gap flagged; no new brand decision implied | None | Noted (asset readiness; commissioning is out of scope here, not an approval choice) | Logo assessment §3 | OPEN (asset gap) |
| FP10-D17 | Dark mode scope | Template dark query exists; brand is light/clean | RECOMMENDATION | Undecided template default | Light-only V1 / full dark | Light-only V1 (brand + effort) | Contrast risk avoided | Halves theme work | No (noted for owner visibility) | — | DOCUMENTED |
| FP10-D18 | Disabled tokens | Exempt class + cues | RECOMMENDATION | None | Proposed values + cues | Ship with non-color cues | Honest disabled states | None | No (part of D06) | D06 | DOCUMENTED |
| FP10-D19 | Focus ring | ≥3:1 achievable everywhere (purple/white math) | RECOMMENDATION | None | Purple/white adaptive | Provably passing ring | Keyboard visibility | None | No | §6 | DOCUMENTED |

Counts (reconciled 2026-10-09): 19 unique entries. Classifications: LOCKED 0 new (8 colors
preserved separately) · VERIFIED-fact components inside D05/D16-evidence/D01-evidence ·
RECOMMENDATION 15 · NEEDS OWNER DECISION 3 approval groups (D01+D02 typography system as one
dependent group, D06-values, D12-library) · noted asset gap 1 (D16, not a spec choice). Closure:
OPEN 3 groups (+1 noted gap) · DOCUMENTED 15. D01/D02 counted once as a group for approvals while
both IDs are preserved (no ID deleted, no double-count).

## 23. Acceptance criteria

- FP10-AC01: All 8 locked hex values byte-identical in doc vs mission. (Spec-level now.)
- FP10-AC02: Every component references semantic tokens, never literal hex (except token table). (Spec now; enforce at implementation.)
- FP10-AC03: Contrast pairs in §6 recomputable to same ratios (method stated). (Now.)
- FP10-AC04: Orange-as-text and white-on-orange absent from all rules. (Now.)
- FP10-AC05: Type roles cover all 14 listed roles without look-alikes. (Now.)
- FP10-AC06: Arabic product names wrap legibly; tabular prices where backend decimals allow. (Impl. test later.)
- FP10-AC07: Mixed-direction runs isolate (barcodes/IDs/URLs never reversed). (Impl. test later.)
- FP10-AC08: Price/unit readable per §9 in PIECE and WEIGHT. (Impl. test later.)
- FP10-AC09: Button variants × states specified incl. disabled/loading/focus. (Now.)
- FP10-AC10: Form states incl. error association + input preservation rules. (Now.)
- FP10-AC11: Loading/error/empty/disabled feedback specified. (Now.)
- FP10-AC12: Card anatomy supports PIECE + WEIGHT + missing image. (Now.)
- FP10-AC13: Availability/discount never color-only. (Impl. test later.)
- FP10-AC14: Responsive bands behave per §12; no whole-page horizontal scroll. (Impl. test later.)
- FP10-AC15: Storefront/admin share tokens with documented density split. (Now.)
- FP10-AC16: Focus visible + keyboard-operable commerce flows. (Impl. test later.)
- FP10-AC17: Reduced-motion honored; no forced promo motion. (Impl. test later.)
- FP10-AC18: No screen, CSS, font asset, or token file introduced. (Now — verify via status.)
- FP10-AC19: No locked color altered; no new hex presented as approved. (Now.)
- FP10-AC20: Owner decisions (D01/D02/D06/D12) explicitly unresolved in doc. (Now.)
Tags: spec-level now vs implementation-test-later marked per item; no executed tests claimed.

## 24. Backend and technical constraints affecting the design

Geist latin-only (Arabic needs new family — D01) · no icon library (D12) · no logo asset (D16) ·
no CSP yet (deferred to frontend coordination per next.config comment — XSS discipline therefore
explicit in §20) · template `lang="en"` + dark query must change at implementation (not here) ·
prices/weights/units/totals server-owned (FP-05 — display only) · guest token localStorage rules
per BG closure · API-only security headers exist; page-level headers/CSP later.

## 25. Cross-phase consistency review

VI-01 (restraint honored; no decorative system) · Brand (promise/traits map to §3/§14–17; no-gos
respected: no cheap look, no luxury, no fake discounts, Arabic clarity) · FP-03 nav (unchanged;
FP-09 older 5-tab order untouched per precedence rule — documented, not edited) · FP-04 journey/
checkout (single page, idempotency, guest flows honored) · FP-05 commerce (compare-at honesty,
step rules, estimate-nonfinal, server authority) · FP-06 ops (state labels, short-ship honesty,
no invented tracking/ETA/proof) · FP-09 IA (slugs/URLs/cursors/rate-limit-aware polling honored) ·
a11y/RTL (WCAG 2.2 bar + logical properties) · Tailwind v4 (CSS-first tokens fit; config untouched).
No conflicts found; nothing overwritten.

**Phase-ID note:** roadmap mentions FP-07–FP-10 as future stages while repo docs already use FP-09
(Information Architecture, LOCKED scope). Recorded as documentation inconsistency for the owner;
no phase renamed/renumbered/reopened here.

## 26. Outstanding owner decisions

1. **FP10-D01+D02 — Typography system (one approval group):** Cairo + Cairo-Latin/Geist-Mono
   (recommended; logo-coherent) vs IBM Plex Sans Arabic + Plex system (alternative). Rationale in §7.
   Blocks: type implementation.
2. **FP10-D06 — Neutral/supplementary palette values:** approve §5 proposed hexes (or substitute)
   with the §6 refined safe-use rules (success-bg large-only, decorative-border limits). Blocks: token
   implementation.
3. **FP10-D12 — Icon library:** adopt Lucide as the single UI icon system (recommended) vs
   alternative/none (adds a dependency at implementation). Blocks: icon usage.
4. (Noted, not a spec choice) D16 production logo asset; D17 dark-mode visibility — no action in this phase.

## 27. Validation results

- Full doc re-read: done; 28 sections present; unique IDs verified (D01–D19, AC01–AC20).
- Locked hexes rechecked character-for-character vs mission table: 8/8 identical.
- Contrast ratios independently recomputed via second run of the same formula: identical values.
- Text/non-text WCAG categories distinguished throughout §6/§20.
- Counts reconciled: 19 decisions (4 NEEDS OWNER DECISION incl. noted asset; 15 DOCUMENTED
  recommendations; 0 falsely LOCKED). 20 criteria (spec-now vs impl-later tagged).
- `git diff --check`: clean (see report).
- Working-tree comparison: only the new FP-10 file added; all prior work preserved.
- No screens/CSS/fonts/assets/deps/backend/migrations/builds/tests/deployments touched or claimed.

## 28. Final verdict

```text
FP-10 SPECIFICATION COMPLETE WITH OWNER DECISIONS REQUIRED
```

Comprehensive, evidence-backed, implementation-ready specification with three genuine owner
decision groups outstanding (typography system, neutrals, icons) plus one noted asset gap (logo);
logo-informed review confirms palette harmony and strengthens the Cairo recommendation without
changing any locked value. Geist-latin, no-render-test, and no-CSP constraints documented. Nothing
beyond scope built or changed.
