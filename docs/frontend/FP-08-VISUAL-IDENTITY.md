# FP-08 — Visual Identity (Specification Only)

> Roadmap note: no FP-08 file existed (verified glob). This file REUSEs BRAND-STRATEGY-v1 (LOCKED) and FP-10
> (§§3–20 foundations + logo reference) and ADDs only: brand-mark usage rules, photography direction, asset
> inventory, and the identity decision register. Colors/type/shape/motion/icons are NOT redefined here —
> FP-10 remains authoritative. No logo/file created, no asset replaced, no code/deps. Static review only.

## 1. Feature coverage matrix (FP-08 scope)

| ID | Requested feature | Existing spec | Coverage | Evidence | Action | Final status |
|---|---|---|---|---|---|---|
| FP08-F01 | Logo/wordmark/symbol rules | FP-10 §logo-ref (reference observed, no repo asset) | PARTIAL (usage rules missing) | FP-10 §§40–53; public/ = framework SVGs | EXTEND (§2) | CLOSED (conditional rules) |
| FP08-F02 | Favicon/app icon | None (no asset) | MISSING | public/ inventory | ADD (§2, pending-asset) | CLOSED (deferred-asset rule) |
| FP08-F03 | Color system | FP-10 §§4–6 (locked + semantic + contrast) | COMPLETE | 8/8 hexes verified | REUSE | CLOSED |
| FP08-F04 | Warning/info/neutral tokens | FP-10 §5 + D06 (proposed, pending owner) | COMPLETE as proposal | Contrast recomputed | REUSE (no new hex) | CLOSED (pending-approval state kept) |
| FP08-F05 | Typography | FP-10 §§7–9 (Cairo rec + Plex alt, pending D01/D02) | COMPLETE as proposal | Google Fonts API verified | REUSE | CLOSED (pending-approval state kept) |
| FP08-F06 | Photography direction | FP-10 §16 (card anatomy) only | PARTIAL (art direction missing) | No photo set in repo | ADD (§3) | CLOSED |
| FP08-F07 | Iconography | FP-10 §18 (Lucide rec, pending D12) | COMPLETE as proposal | No icon dep in repo | REUSE | CLOSED (pending-approval state kept) |
| FP08-F08 | Shape language | FP-10 §13 | COMPLETE | Tokens defined | REUSE | CLOSED |
| FP08-F09 | Motion personality | FP-10 §20 | COMPLETE | Rules defined | REUSE | CLOSED |

## 2. Brand-mark system (usage rules; NO new artwork; approval state per item)

Source: owner-supplied raster reference reviewed in FP-10 (orange/purple circular emblem + «هايبر/المعتصم»
wordmark + HYPER ELMOATASEM latin; bold rounded retail voice). No vector/source/asset in repo (D16 open).

| Item | Rule | Status |
|---|---|---|
| Logo (emblem + wordmark) | Use approved artwork only, unmodified (no recolor/re-proportion/redraw) | Pending asset (D16) |
| Wordmark arrangement | Arabic «هايبر» orange + «المعتصم» purple locked order per reference; Latin letterspaced below | Conditional on asset |
| Symbol (emblem-only) | Required variant for favicon/small sizes (wordmark fails at favicon scale — FP-10 rule kept) | Conditional on asset |
| Favicon / app icon | Emblem-only, from approved source when available; until then framework default stays (never a fake mark) | Deferred asset |
| Light/dark backgrounds | White/light confirmed safe (as shown); dark/overlay/photographic UNVERIFIED — test at implementation, default to safe surfaces | Rule + pending test |
| Clear space / safe area | ≥ emblem height/4 on all sides (rule, proportional — no artwork change) | SELECTED (FP-08, reviewable) |
| Minimum size | Emblem ≥ 24px digital; full lockup ≥ 96px wide (below ⇒ emblem-only) | SELECTED (reviewable) |
| Over photos/color | Allowed only on calm light areas with safe-surface fallback; never over promo noise | SELECTED (reviewable) |
| Forbidden | Recolor, stretch, rotation, gradients, shadows on mark, busy backgrounds, mark-as-icon redraw | LOCKED direction (brand no-gos) |
| Storefront vs admin | Same mark both surfaces (one identity); admin may use compact emblem + wordmark text | SELECTED (reviewable) |

SELECTED ≠ owner-approved: §5 register marks each new rule accordingly; D16 asset still gates real usage.

## 3. Photography & image direction (Modern Local Hypermarket; honest-product doctrine)

Product: true-packaging clarity (label readable at card size), neutral light background, accurate color (no
saturation push that misrepresents contents), single-angle consistency per catalog shoot, contain-fit (never crop
away pack info). Hero/banners: calm organized retail scenes, human-warm, no luxury staging, no urgency collage;
validity-gated (approved source + date window only). Lifestyle (if ever sourced): real daily-shopping contexts,
Egyptian-household-plausible, no staged affluence. Quality bar: in-focus, ≥ card-slot resolution, consistent white
balance across a category; non-conforming supplier images flagged as content debt (§FP-07 §6), never auto-"enhanced"
into misleading claims. Cross-device: same crop logic (contain), density via reserved slots (no layout shift).

## 4. Asset inventory (present vs missing — verified, not modified)

Present: `public/file.svg, globe.svg, next.svg, vercel.svg, window.svg` (framework defaults, NOT brand assets).
Missing: logo source/vector, favicon, app icon, banners, hero set, policy texts, fallback art set, product-photo
set (external URL metadata only). Nothing here authorizes fabricating any of them.

## 5. Decision register (new FP-08 items only; FP-10 D-items untouched)

| ID | Item | Decision | Source | State | Rationale / rejected | FP-09/DS impact |
|---|---|---|---|---|---|---|
| FP08-D01 | Mark usage + favicon/app rules | §2 table | Reference + no-go doctrine | SELECTED (reviewable); asset D16 still owner-open | Rejected: redraw/trace artwork (no authority) | Image/favicon specs consume |
| FP08-D02 | Clear-space/minimums/surfaces | §2 values | Proportional practice, brand restraint | SELECTED (reviewable) | Rejected: fixed-px dogma (scales vary) | Logo component rules |
| FP08-D03 | Photography doctrine | §3 | Brand traits (organized/practical/calm) | SELECTED (reviewable) | Rejected: luxury/urgency staging | Gallery/hero specs |
| FP08-D04 | Colors/type/shape/motion/icons | Unchanged from FP-10 | FP-10 §§4–20 | REUSED (pending approvals D01/D02/D06/D12 stay open) | No alternative proposed | Tokens consumed as-is |

## 6. Acceptance (DEFINED — NOT EXECUTED)

Coverage matrix (§1) · mark rules without new artwork (§2) · photo doctrine (§3) · asset inventory (§4) ·
register with honest states (§5) · zero color/type redefinition · zero pending-approval presented as approved ·
FP-10/BRAND untouched.

---

*End of FP-08 — specification-only, no implementation.*
