# FP-02 — Product Positioning & Brand Strategy + Backend Capability & API Contract Audit

> **Status:** SPECIFICATION-CLOSED (documentation + static audit only).
> **Authority:** `docs/frontend/BRAND-STRATEGY-v1.md` (LOCKED 2026-10-08, owner-approved full package) is the
> governing source for all brand decisions below. Nothing LOCKED there is reopened here.
> **Evidence hierarchy:** implementation/tests > `docs/openapi.yaml`/schemas > approved decisions > prior FP specs.
> **Scope:** brand operationalization (axes meaning, content/design rules, review criteria) + brand-relevant
> backend capability summary + error/gap registers + brand-to-backend consistency. No storefront code, no
> backend/API/schema change, no migration/seed, no install, no commit/push/deploy, no `AGENT-HANDOFF.md` edit.
> **Review method this task:** static only — contract + route/service/validation code + existing specs read.
> No live server, no DB traffic, no operational API proof claimed (per mandate rule 11).
> **Non-duplication:** full screen→API inventory lives in FP-13 §1; full error scenarios in FP-11.10;
> full closure register in FP-11.11 §C. This doc summarizes the brand-relevant slice and references those
> sources instead of copying them.

## 1. Phase inventory & classification

| # | Item | Document / location | Existing decision | Approval | Classification | Gap → action → result |
|---|---|---|---|---|---|---|
| 1 | FP-02 file | None existed (glob `**/*FP-02*` empty; FP-20:24 records "zero references … stale numbering") | — | — | `NOT FOUND` → `EXISTING` (this doc creates the FP-02 record) | Numbering gap → create this doc per owner task, bind brand source + capability summary → closed here |
| 2 | Brand strategy source | `docs/frontend/BRAND-STRATEGY-v1.md` (117 lines) | Positioning Modern Local Hypermarket; promise; differentiation; emotional goal; 8 no-gos; A1–A7 + axes + traits; coherence accepted | LOCKED owner-approved 2026-10-08 | `EXISTING — VERIFIED` | None on decisions → preserved verbatim; operationalization added below as derivation → kept |
| 3 | Positioning axes A1–A7 | BRAND §4 (7 rows with scores/rationale/risk) | Local-first, clearly modern, family-leaning, warm-first, practical, calm+selective energy, value-fair | LOCKED | `EXISTING — GAPS FOUND` (practical meaning/examples/review hooks missing) | Operational meaning + means/does-not-mean → §2.2 added as derivation, no approval changed → closed |
| 4 | Personality axes + traits | BRAND §§6–7 (8 axes + 5 primary traits + modern supporting) | Warm 2, practical 2, calm 3, familiar 3, expressive 4, approachable 3, organized 2, value-led 2 | LOCKED | `EXISTING — GAPS FOUND` (tone/content/card/error impact + allowed/forbidden examples missing) | Per-axis usage tables → §2.3 added as derivation → closed |
| 5 | Brand promise | BRAND §8: «احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.» + scope note | Clarity/information trust; no service guarantees, no cheapest/assortment claims | LOCKED | `EXISTING — VERIFIED` | Wording kept exactly; checks recorded in §2.4 → kept |
| 6 | Differentiation | BRAND §9 (primary transparency + 2 supporting + explicit non-claims) | Transparency primary; household-ease; local familiarity; no superiority claim | LOCKED | `EXISTING — VERIFIED` | Split into value/goal/verified/forbidden in §2.5 → kept |
| 7 | Emotional goal + 5-second test | BRAND §§10–11 | Trust/reassurance via clarity+organization; 5 Arabic test questions | LOCKED | `EXISTING — VERIFIED` | Observable criteria added in §2.6 as derivation → kept |
| 8 | Design No-Gos | BRAND §12 (8 prioritized items) | As listed in §2.7 | LOCKED | `EXISTING — VERIFIED` | Per-item reason/example/alternative/review hook in §2.7 → kept |
| 9 | Task-summary wording vs source | Task §4.1 lists 5 traits + 9 no-go bullets | Source has 5 primary traits (+1 supporting + 8 axes) and 8 no-gos (luxury + corporate-cold combined in one) | Source prevails | `CONFLICT DETECTED` → resolved | Task summary treated as approximate; source wording authoritative; mapping noted in §§2.3/2.7 → resolved, no approval needed |
| 10 | FP-20 "FP-02 stale numbering" | FP-20:24 + FP-20:208 (FP-02/08 zero refs → "false blocker removed") | Old roadmap numbering gap, not a brand-scope verdict | Roadmap note | `CONFLICT DETECTED` → resolved | FP-20 meant no FP-02 *file* existed then; this owner-tasked doc recovers the numbering by binding the existing brand source. No FP-20 rule changed → resolved |
| 11 | FP-10 visual identity link | `FP-10-VISUAL-IDENTITY-DESIGN-SYSTEM.md` §§3–4 (brand principles + locked palette) | Purple `#511D9C`/Orange `#FF7100`/Ink `#1B1530` + surfaces + success/error; Cairo recommended (owner decision open); logo reference-only | LOCKED palette; rest RECOMMENDATION/OPEN | `EXISTING — VERIFIED` | No color/type change here; mapping to traits in §7 → kept |
| 12 | FP-11→FP-14 scope | FP-11.1–11.11, FP-12, FP-14 specs | Screen journeys, component contracts, state/cache/session/cart/retry rules | Spec-closed | `EXISTING — VERIFIED` | Referenced, not redefined; consistency in §7 → kept |
| 13 | FP-13 contract mapping | `FP-13-CONTRACT-MAPPING-SPECIFICATION.md` (141 lines, 98 paths) | Screen→API inventory §1, pagination §1.1, comm layer §3, auth §4, errors+idempotency §5, gaps §6 | Spec-closed | `EXISTING — VERIFIED` | Full table NOT duplicated here (§8 rule 1); brand slice summarized in §3 with pointers → kept |
| 14 | OpenAPI contract | `docs/openapi.yaml` (98 `/api/` paths verified this task; 189 auth/error-signal refs) | Storefront + admin + health paths as listed in §3 | Contract doc | `EXISTING — VERIFIED` | Read statically; absence of autocomplete/reviews/payments/OTP/upload/CSV/metrics/tracking verified by zero-hit grep → recorded in §5 |
| 15 | Prior capability/error registers | FP-11.11 §§B–C (25-row inventory), FP-11.10 (11 scenarios), FP-13 §§5–6 | SUPPORTED/UNSUPPORTED lists; G-P1/D39/L1–L5/G5/G1–G4/B1–B7/Q-PAY/C-UNIT/C-NAME/D41/D44 | Closed/accepted per register | `EXISTING — VERIFIED` | Reused by reference; FP-02 gap IDs added in §5 without renumbering prior IDs → kept |
| 16 | Backend behavior proof | Route/service/validation files cited in §3 (static read only) | As evidenced per row | Code fact | `EXISTING — VERIFIED` (static) | No live run this task; evidence status marked "static-read, no live proof" → honest limitation recorded |

**Rule applied:** no closed decision reworded in a meaning-changing way; new text is labeled derivation/recommendation/open and never silently approved.

## 2. Brand strategy final state (all decisions LOCKED; usage text is derivation)

### 2.1 Positioning statement (LOCKED, verbatim)

**للعائلة المصرية في التسوق الأسبوعي واليومي، هايبر المعتصم هو السوبرماركت المحلي العصري اللي بيخلي طلب البيت كله سهل وواضح بسعر عادل، مدعوم بأسعار معلنة بوضوح، وأوزان وتوفر صادقين، وتجربة منظمة من البحث حتى التوصيل.**

Scope guard (BRAND §5): household scope is an assortment-logic hypothesis, not researched demographics — wording must stay inclusive of individuals.

### 2.2 Positioning axes matrix (LOCKED positions; practical columns are derivation)

Scale note: numbers are illustrative clarity aids from the source, not customer research.

| Axis | LOCKED position | Evidence | UX/content/design impact | Means in practice | Does NOT mean | Status |
|---|---|---|---|---|---|---|
| A1 Local vs Premium | Local-first, professional quality (Local 2 / prestige 3) | BRAND §4; warmth+familiarity traits | Neighborhood tone; fair-value framing; no luxury cues | قريب ومحترم التنفيذ | الأرخص/الأكبر/تغطية جغرافية مدّعاة | LOCKED; usage derived |
| A2 Modern vs Traditional | Clearly modern, familiar spirit (Modern 6) | BRAND §4; e-commerce expectations | Organized digital fluency: clarity, consistency, usable search/nav | سهولة رقمية منظمة | بهرجة تقنية أو برود شركات | LOCKED; usage derived |
| A3 Family vs Convenience | Household first, comfort core, inclusive of individuals | BRAND §4; weights/assortment logic | Stock-up journeys + easy single flows; inclusive copy (no family-only image) | طلب بيت + راحة للكل | استهداف عائلي حصري مثبت ديموغرافيًا | LOCKED; usage derived |
| A4 Friendly vs Authoritative | Warm first, quiet confidence (Warm 2–3) | BRAND §4; approachable-first axis | Human simple Arabic; authority from accuracy/consistency, not formality | دفء + ثقة هادئة | تساهل مفرط أو صرامة مؤسسية | LOCKED; usage derived |
| A5 Practical vs Aspirational | Everyday usefulness (Practical 2) | BRAND §4; value-led axis | Fewest steps to buy; price/unit/availability/add co-located | نفع يومي بسعر عادل | طموح نمط-حياة أو فخامة | LOCKED; usage derived |
| A6 Fast vs Calm | Fast operation, calm feeling, energy only on merit (Calm 3) | BRAND §4; calm-energetic axis | Efficient flows, no urgency patterns, no competing attention-grabbers | سرعة مريحة بلا قلق | عدّادات وهمية أو إلحاح ترويجي | LOCKED; usage derived |
| A7 Affordable vs Premium | Clear value, honest prices, real-offer savings (Value-fair 3) | BRAND §4; old-price-only-from-real-data rule | Noise-free pricing; discount only backed by real data | قيمة عادلة معلنة | ادعاء "الأرخص" أو مظهر رخيص | LOCKED; usage derived |

### 2.3 Personality axes matrix (LOCKED scores; usage columns are derivation, not new palette/type)

| Axis (1↔7) | LOCKED score | Evidence | Arabic tone impact | Content density/order impact | Card/price/offer/error impact | Allowed example | Forbidden example (vs No-Gos) |
|---|---|---|---|---|---|---|---|
| Warm ↔ Formal | 2 | BRAND §6 | مصرية بسيطة محترمة، بلا تكلّف ولا مبالغة صحوبية | عناوين واضحة، تعليمات قصيرة | رسائل خطأ بشرية هادئة تذكر الخطوة التالية | «السعر شامل الوزن الموضح» | «عزيزي العميل الكريم!!!» (ضوضاء + تكلّف) |
| Practical ↔ Aspirational | practical 2 (via A5) | BRAND §§4/6 | لغة نفعية مباشرة | المعلومات الشرائية أولًا، الزخرفة لاحقًا | السعر/الوحدة/التوفر في نظرة واحدة | «٥٠٠ جم × ٣٢٠ ج.م/كجم ≈ ١٦٠ ج.م (تقدير قبل التجهيز)» | «عيش تجربة التسوق الفاخرة» (فخامة منفّرة) |
| Calm ↔ Energetic | 3 | BRAND §6 | هادئ وواثق؛ حماس فقط لقيمة حقيقية | لا عناصر متنافسة على الانتباه | البرتقالي للعروض الحقيقية فقط | شارة عرض واحدة عند وجود خصم حقيقي | صفحة كلها شارات وومضات (ضوضاء ترويجية) |
| Familiar ↔ Sophisticated | 3 | BRAND §6 | عربي مصري مألوف، صقل في التنفيذ لا تكلّف | مصطلحات أوزان/وحدات دقيقة | لا تضليل في وحدة/وزن المنتج | «وزن تقريبي عند التجهيز» | مصطلحات أعجمية غامضة أو عربية ركيكة |
| Understated ↔ Expressive | 4 | BRAND §6 | كل رسالة تستحق الانتباه | التعبير بقدر القيمة (عرض/معلومة حقيقية) | لا تضخيم علامات تعجب | إبراز هادئ لخصم مثبت | «🔥🔥 خصم جنوني لفترة محدودة!!!» |
| Approachable ↔ Authoritative | 3 (from A4) | BRAND §6 | مقترب أولًا؛ السلطة من الكفاءة | إخفاء خلف الواجهة سلوك UX فقط (السيرفر يفرض) | لا إخفاء لفشل/تغيير سعري | «السعر اتغيّر من كذا لكذا — أكّد قبل الدفع» | إخفاء انقطاع/تغيير وتمريره بصمت |
| Organized ↔ Playful | 2 | BRAND §6 | التنظيم هو اللغة البصرية | كل عنصر يستحق بكسلاته للمهمة | ممنوع الطابع اللعبي قرب المال/الدفع | لمسات خفيفة بعيدًا عن السعر/الدفع | خطوات/مكافآت لعبية عند الدفع |
| Value-led ↔ Prestige-led | 2 (from A7/A1) | BRAND §6 | قيمة عادلة معلنة | أسعار واضحة بلا صخب خصومات | خصم فقط ببيانات حقيقية | «وفّر X بخصم مثبت من السيرفر» | إشارات فخامة أو أسعار مبهمة |

No color/typography change is made here; palette and Cairo recommendation stay under FP-10 authority.

### 2.4 Promise (LOCKED)

**«احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة.»**

Checks recorded: واضح ومختصر ✓؛ واقعي وتعكسه تجربة منظمة ✓؛ بلا ضمانات أسعار/توصيل/توفر ✓ (النطاق: ثقة معلوماتية، أزمنة التوصيل تحتاج تحققًا مستقبليًا)؛ مناسب لاحتياجات المنزل المحلية ✓؛ متسق مع سياسات المتجر الفعلية ✓. لا صياغة بديلة معتمدة؛ ملاحظات التحسين (إن وجدت) توصيات فقط.

### 2.5 Differentiation (LOCKED hierarchy; four-way split for honesty)

| Claim | Class | Evidence | Frontend rule |
|---|---|---|---|
| شفافية تجارية: سعر/وحدة واضح، أوزان صادقة مع شرح الفعلي، توفر ظاهر، عروض غير مضللة، وضوح حالة الطلب/الاستبدال | Real value + verified capability | Backend enforces (snapshots, actuals, drift surfacing, OOS visibility); §3 rows | اعرض دائمًا من استجابات السيرفر؛ لا تُخفِ تغييرًا |
| تنظيم يسهّل طلب البيت: كتالوج كبير قابل للتصفح، شفافية عملية | Experience goal for design | Journeys FP-11.1–11.5; components FP-12 | حققه التصميم (تنقل/بحث/بطاقات/سلّة)، لا يُدَّعى كميزة مثبتة بذاته |
| ألفة محلية موثوقة: نبرة وقرب | Experience goal for design | Traits/tone §§2.3–2.4 | حققها المحتوى والنبرة، لا تُحوَّل لادعاء جغرافي |
| الأرخص/الأسرع/الأكبر/الأفضل — أي تفوق سوقي | Forbidden marketing claim | No research, no competitor study (BRAND §2) | ممنوع حتى يتوفر دليل مستقل |

### 2.6 Emotional goal — first five seconds (LOCKED goal; criteria are derivation)

Primary: **ثقة وراحة عبر الوضوح والترتيب** ("مكان منظم ومحترم يفهم احتياجات اليوم"). Supporters: comfort/ease, organized variety (never overclaimed). Avoid: luxury awe, promo noise, urgency/anxiety, boredom.

Observable criteria (design requirements, not tested facts): اسم المتجر وهويته واضحان؛ البحث والتنقل واضحا الوظيفة؛ بداية التسوق مفهومة (أقسام/بحث)؛ المحتوى والعروض منظمة؛ السعر والتوفر مميّزان بلا ضوضاء؛ لا ازدحام برسائل/عروض غير ضرورية. Five-second test questions (BRAND §11) are the review instrument.

### 2.7 No-Gos (LOCKED list; columns are operational aid)

| # | Rejected | Why (brand context) | Written example | Suitable alternative | Design-review check |
|---|---|---|---|---|---|
| 1 | ادعاءات غير مثبتة (الأرخص/الأسرع/الأفضل) | بلا بحث/منافسين؛ تهدم الثقة | «أرخص هايبر في مصر» | «سعر معلن بوضوح: X ج.م / كجم» | هل توجد صفة تفضيل بلا مصدر؟ |
| 2 | ضوضاء ترويجية (كل شاشة إعلان) | تكسر الهدوء المنظم | 5 شارات متنافسة في viewport واحد | شارة واحدة لعرض حقيقي | عدّ العناصر الترويجية المتنافسة |
| 3 | أسعار/عروض غامضة (بلا وحدة/وزن) | تهدم الشفافية الأساسية | «١٦٠ ج.م» بلا وزن/وحدة | «١٦٠ ج.م / ٥٠٠ جم (تقدير)» | هل يُقرأ السعر+الوحدة بنظرة؟ |
| 4 | مظهر رخيص (صخب خصومات/عدّادات وهمية) | يتعارض مع "محترم/عادل القيمة" | عدّاد تنازلي مزيف | خصم هادئ مثبت ببيانات | هل يُحرج التصميم بجانب السعر الحقيقي؟ |
| 5 | قالب عام بلا شخصية | يمحو الألفة المحلية | صفحة يمكن تبديل شعارها مع أي متجر | نبرة مصرية + تنظيم خاص | هل يمكن تبديل الشعار دون فرق؟ |
| 6 | فخامة منفّرة أو برود مؤسسي (مدمجان في المصدر) | ينفّران عن هايبر محلي يومي | لغة رسمية متكلفة/صور فاخرة | دفء إنساني + دقة مهنية | هل يبدو قابلًا للتسوق اليومي؟ |
| 7 | عربية ضعيفة أو تضليل وحدات | تهدم الثقة المعلوماتية | وحدة/وزن غامض أو ركيك | مراجعة مصطلحات خاصة بالأوزان | مراجعة لغوية + وحدات |
| 8 | زخرفة تتقدم على المعلومات | تكسر "التنظيم لغة بصرية" | زخارف تبطئ فهم السعر/التوفر | إزالة ما لا يخدم المهمة | هل إزالته تضر بالمهمة؟ |

Creative freedom remains: illustration style, tone within traits, calm promotional layouts.

### 2.8 Strategy-to-design/content rules

1. الأسعار والوحدات والأوزان والتوفر من استجابات السيرفر فقط؛ الواجهة تعرض ولا تخترع.
2. الخصم القديم (old-price) فقط من بيانات backend حقيقية؛ لا شارات لعروض غير مثبتة.
3. البرتقالي للطاقة التجارية الحقيقية فقط؛ النص البرتقالي المقروء `Text Orange` لا `Brand Orange` كنص.
4. العربية أولًا RTL، أرقام/عملة `152 ج.م`، تواريخ Gregorian/Africa/Cairo.
5. كل شاشة تجتاز أسئلة الثواني الخمس + قائمة No-Gos قبل اعتماد التصميم.
6. رسائل الأخطاء بشرية هادئة + خطوة تالية، بلا لوم وبلا كشف بيانات.

### 2.9 Decisions / derivations / open

- LOCKED (untouched): A1–A7, 8 axes + 5 traits (+modern), promise wording, differentiation hierarchy, emotional goal + test, 8 no-gos, coherence acceptance, full-package approval 2026-10-08.
- Derivations added here (not approvals): §§2.2–2.3 usage columns, §2.6 criteria, §2.7 review hooks, §2.8 rules.
- Open (non-blocking residuals per BRAND §14): demographics validation; competitor evidence; delivery/payment provider realities when they land.
- Assumptions (not policy): household-scope hypothesis; local-tone resonance; transparency-as-differentiator strength.

### 2.10 Design review criteria (for later phases)

Positioning checklist (§2.2 means/does-not-mean) + personality allowed/forbidden (§2.3) + promise checks (§2.4) + five-second questions (§2.6) + No-Go checks (§2.7). No visual design is executed in this task.

## 3. Backend capability summary — brand-relevant slice (static read; full matrix in FP-13 §1)

Conventions (per FP-13): envelopes `{data,meta}`/`{error:{code,message,details}}`; decimals exact strings (money 2dp, qty 3dp);
pagination endpoint-specific (limit 1–100, `nextCursor|null`, forward-only, no totals/offsets). Evidence status below means
"contract + code statically read; no live run this task" — never a live proof.

| Domain | Method + Path (real) | Contract + impl evidence | Auth / permission | Key req/resp | Pagination | Error behavior | Frontend use | Status | Limitations |
|---|---|---|---|---|---|---|---|---|---|
| Catalog lists | `GET /api/store/catalog/products`, `/categories`, `/brands` | openapi 98 paths; `catalog/products/route.ts`, `queries.ts:5-33`, `validation.ts:99-122` | Public | filters (category/brand/type/price/inStock/search) + sort name/created_at + limit/cursor; rows w/o price/stock/image | Opaque keyset, `meta{limit,nextCursor}` null=end; malformed→400 | 400 sanitize | Browse/list pages; enrichment per-card | SUPPORTED (static) | No totals/counts; no popularity; no price sort |
| Search | `GET /api/store/catalog/search` | openapi; `search.ts:41-69,210-236`, `validation.ts:86-97` (q 2–120, sorts relevance/newest) | Public | q required (empty→400); filters category/brand/type/price/inStock; search cursor (tier/sim/id) | Search cursors, forward-only | 400 on empty/invalid | Submit-only search results | SUPPORTED (static) | No autocomplete; no price/popularity sort |
| PDP + variants + images | `GET /api/store/catalog/products/{id}`, `.../{id}/variants`, `.../{id}/images`, `/variants/{id}` | openapi; product/variant/image routes | Public | Variant = price/unit authority; gallery fallback `{primary:null,gallery:[]}` | Variant list: fixed name-asc keyset | 404 unknown/inactive | PDP, variant selector, gallery | SUPPORTED (static) | No reviews/related/restock-notify |
| Inventory reads | `GET /api/store/inventory/products/{id}`, `/variants/{id}` | openapi; inventory queries/serialize | Public | Availability strings; GENERATED available read-only | N/A (single reads) | Unknown-stock ≠ OOS (must not conflate) | Stock status, add gating | SUPPORTED (static) | No alerts; no zones |
| Units/pricing authority | Admin `PATCH /api/admin/catalog/variants/{id}/price`; store reads snapshots | `validation.ts:53-67` (`productUnitSchema` PIECE/KG/GRAM; `sizeUnit` 5 metadata incl. LITER/ML); `writes.ts:76-86` weight rule | Store public reads; admin `products.update` | 2dp price string; compare-at 422 guard; saleStepGrams validation | N/A | 400 boundary (LITER/ML as sale unit); 422 domain weight rule | Display only; never client math as authority | SUPPORTED (static) | LITER/ML metadata-only, never sale units |
| Promotions/coupons | Store: estimate/create apply; Admin: `/api/admin/promotions…`, `/api/admin/coupons…` | openapi; `promotions/engine`, `promotions/checkout.ts` | Store per cart owner; admin `promotions.*/coupons.*` | 4 types; autos+coupon server-side; coupon Checkout-only; 422-checkout family | Admin lists: raw UUID cursors | Expired/inapplicable → discount dropped / `applicable:false+reason`; creation recomputes live | Badges/totals from fresh responses only | SUPPORTED (static) | No feed/analytics/preview; no promo-change events (G-P1) |
| Cart lifecycle | `POST\|GET /api/store/cart`, `POST /cart/items`, `PATCH\|DELETE /cart/items/{variantId}`, `POST /cart/merge`, `POST /cart/reprice` | openapi; `cart/route.ts:15-60` (mint 201/bearer-once, XOR owner), `writes.ts:203-267,397-416` | `x-guest-token` XOR customer session (never client customerId) | Full-cart echo; bearer returned once (hashed at rest); step rules | N/A | 400 both-sides/validation; 401 no identity; 404 gone-cart; add UPSERT sums (NOT idempotent) | Draft cart UI; merge explicit (login never auto-merges) | SUPPORTED (static) | Gone-cart → fresh mint; no guest-list history |
| Estimate | `POST /api/store/orders/estimate` | openapi; `orders/estimate/route.ts:1-6` (read-only dry run) | Session XOR guest bearer | Snapshots preview; coupon 404-vs-422 difference intentional (dry-run vs commit) | N/A | Never final/committed; response may change | Preview totals; never submit stale as final | SUPPORTED (static) | Repeatable but never same-guaranteed |
| Order create | `POST /api/store/orders` (+`Idempotency-Key` header and/or body `idempotencyKey`) | openapi:619-640; `orders/route.ts:31-60` (header-wins, conflict→400, key required); `writes.ts:172-202,524-529` UNIQUE + same-cart replay/409-different-terms | Session XOR guest bearer + inline guest address/contact | One tx (reserve+snapshots+history+CHECKED_OUT+credential); fresh guest 201 + raw credential once; replay 200 + `meta.replay` | N/A | 400 conflict/ambiguous; 409 drift/stock/different-terms; 500/timeout → ambiguous: resolve via same-key replay, never blind new key | Idempotent submit; timeout → re-read + same-key resolve | SUPPORTED (static) | Key scope is same-cart terms; fresh key = NEW order |
| Order read/cancel (customer) | `GET /api/store/orders`, `GET /api/store/orders/{id}`, `POST /api/store/orders/{id}/cancel` | openapi; `orders/queries.ts:30-78,83-86` (keyset list), cancel route | Customer session self-scoped (30d) | Keyset history; cancel widened to PREPARING-unpicked (frozen machine) | Raw UUID cursors, forward-only | 401 expired/revoked; 404 unknown≡foreign (masked); 409 picked/locked | Tracking + cancel UI | SUPPORTED (static) | No guest-list; cancel bounded by machine |
| Guest order access | `GET /api/store/orders/{id}`, `POST …/cancel`, `GET\|POST …/replacements…/decide` + `x-guest-order-token` | openapi:114-117; `guest-access.ts:26-30` (90d fixed, header-only, hash-at-rest); BGGO closure | Per-order bearer (90d TTL; keep-same replay; never order-number-as-auth) | 401/410/404 semantics; lost-credential → staff-assisted rotate/revoke (D39 resolved) | N/A | Expired → terminal; no self-recovery | Read/cancel/decide by credential | SUPPORTED (static) | No self-service recovery link |
| Addresses | `GET\|POST /api/store/customers/addresses`, `GET\|PATCH\|DELETE /{addressId}` | openapi; address routes | Customer session self-scoped | city+phone required; `isDefault` + 409 race | N/A | 400 shape; 404-gone → relist; 409 default-race | Saved addresses or guest inline snapshots (never mixed) | SUPPORTED (static) | No coverage/delivery-zone lookup |
| Auth/session | `POST /api/store/customers/register`, `POST …/session`, `GET\|DELETE …/session`, `PATCH …/password` | openapi; `register/route.ts:51-92` (G5 IP30 + HMAC-phone10 buckets, generic 429, 409 duplicate); session 30d; lockout | Public (register/login) → session cookie `__Host-customer-session` HttpOnly | Generic 401s (no oracle); login mints session per success (NOT idempotent) | N/A | 401 relogin; 409 duplicate→login; 429 backoff (15-min windows) | Register/login/logout/password/orders reads | SUPPORTED (static) | No OTP/reset/profile-PATCH/sessions-list |
| Fulfillment states | Admin: `prepare/ready/dispatch/deliver/cancel/pick/unavailable/replacements…` (12 routes FP-11.8.3) | openapi; frozen state machine | `orders.view/update/cancel` | R2/R7 gates; snapshots; L1 short-ship | Admin lists: raw UUID cursors | 409-gate + refetch | Status display + actuals (requested vs actual vs final) | SUPPORTED (static) | No driver/notify/payments/tracking API |
| Replacements | Store decide + admin propose/approve/withdraw/auto-accept | openapi; replacement queries/writes | Store: owner credential/session; admin: `orders.update` | Holds moved on approve; money finalization at READY | N/A | 409-gate | Replacement choices + outcome messages | SUPPORTED (static) | No auto-swap without approval path |
| Admin catalog/inventory/users/audit | Routes listed in §3 header inventory (brands/categories/products/variants/price/images/codes; inventory 6 + movements; users/roles/grants; audit-logs; settings; session) | openapi; e.g. `admin/catalog/products/route.ts:19,64` (`denyUnless("products.view")`, `adminOrDeny("products.create")`) | Per-permission gates + ceiling/guards; admin 8h sessions | Keyset everywhere; audit append-only, secret-free | Keyset per family (§FP-13 §1.1); audit UUID-over-tuple | 401/403-ceiling/404/409-last-admin/UQ/races | Permission-gated admin UI | SUPPORTED (static) | No MFA/OTP; no bulk/upload; no analytics |

Admin/user/audit rows are grouped (not per-route duplicated) per §8 rule 1; the normative per-route matrix remains FP-13 §1.

## 4. Error & failure matrix (normative for brand-relevant flows; full scenarios in FP-11.10)

| Domain | Operation | Failure case | Evidence | HTTP/error signal | User/frontend impact | Current handling | Required frontend behavior | Backend gap? | Status | Scope/approval |
|---|---|---|---|---|---|---|---|---|---|---|
| Auth | Any session call | Session expired/revoked (30d) | Session routes; FP-11.10 #4 | Generic 401 | Logged-out mid-flow | None server-side beyond 401 | Login prompt; preserve input; reselect + NEW order key; never reuse stale auth | No | Handled by contract | None |
| Auth | Register | Rate/abuse or duplicate | `register/route.ts:51-92`; G5 | Generic 429; 409 duplicate | Blocked or already-registered | Buckets IP30/HMAC-phone10; fail-closed 500 | Backoff message; 409 → login path (no enumeration detail) | No | Supported | None |
| Auth | Privileged/admin action | Missing permission / foreign resource | `denyUnless`/`adminOrDeny`; FP-11.10 #10 | 401 / 403 / 404-masked | Forbidden/not-found | Server-enforced | Login/forbidden/not-found states; never show protected data; 403-stale → re-check session | No | Supported | None |
| Catalog | List/search | Invalid params; empty search | `validation.ts:86-122`; FP-13 §1 | 400 sanitize | No results / corrected | Server validates | Sanitized message; keep query; retry after fix | No | Supported | None |
| Catalog | PDP/inventory | Unknown/inactive product; unknown stock | Variant+product gating; FP-11.10 #1/#11 | 404; unknown-stock distinct from OOS | Not-found / OOS row | Server gates | Not-found path back; OOS `غير متوفر حاليًا` + disabled add, details visible | No | Supported | None |
| Cart | Add/set | Price/stock moved; step violation | `cart/writes.ts`; reprice | 400/409/422 ladder | Stale draft | Echo + reprice | Old→new disclosure + explicit re-confirm; re-read before retry; add never blind-retried | No | Supported | None |
| Checkout | Estimate/create | Drift/stock-short/coupon inapplicable | `writes.ts:172-202`; FP-11.10 #2/#3 | 409 drifted[]/short; coupon `applicable:false+reason` | Cannot commit as shown | Server recomputes live | Benefit omitted without phantom badge; totals from fresh responses; new key after review | No (G-P1: no event stream) | Limited (learn via re-read) | No change; constraint recorded |
| Checkout | Create | Timeout/500, unknown outcome | Idempotency UNIQUE + replay | 500 envelope (generic) | Ambiguous: may or may not have executed | Same-key replay / 409-different-terms | Re-read first; same-key resolve; never blind new key; "must assume possible" (FP-11.10 #8) | No | Supported | None |
| Guest | Cart/order credential | Wrong/interchanged/expired credential | `cart/owner`, `guest-access.ts`; FP-11.10 #5 | 400 both-sides; 404 gone; 401/410 order | Blocked or terminal | Server-separated secrets | Exact-secret routing; mint/re-paste paths; expired → terminal + staff path (D39) | No (D39 resolved) | Supported | None |
| Address | CRUD/select | Missing city/phone; gone; default race | Validation + E11–E13; FP-11.10 #6 | 400 / 404 / 409 | Field error / reselect | Server validates | Field errors (saved) or complete-both-objects (guest); 404 → relist | No | Supported | None |
| Media | Gallery | Null/404/transport | Catalog media; FP-11.10 #7 | `{primary:null,gallery:[]}` / throw | Broken image risk | None (client concern) | Neutral placeholder; layout-stable; per-row retry | No (client-side) | Client rule | None |
| Admin | Mutations | Guard race / concurrent edit | No idempotency keys; 409 guards | 409-guard | Conflict | Server-side first-wins | Re-read + explicit confirm; never blind-retry destructive | No | Supported | None |

No invented codes: every signal above is contract- or code-evidenced. Where the API gives no explicit signal (e.g. image transport), the limit is documented instead of inventing one.

## 5. Gap register (FP-02 IDs; prior IDs reused by reference, never renumbered)

Kind ∈ {backend-gap, doc-gap, design-constraint, product-decision}.

| ID | Description | Evidence | Frontend impact | Kind | What works today | What needs support | Safe alternative | Owner approval for backend change? | Blocker? |
|---|---|---|---|---|---|---|---|---|---|
| FP02-G1 | No standalone offers feed | FP-13 §1 (no feed/preview); FP-11.8.4; openapi zero-hit | Promotions page/section has no dedicated source | backend-gap | Badges/discounts from list/estimate/create responses | Feed/analytics endpoint | Derive offers UI from catalog + estimate responses only | Yes (if ever requested) | No (constraint) |
| FP02-G2 | No catalog counts/aggregations | FP-13 §1 (no totals); keyset `nextCursor\|null` everywhere | No "N results", no counts in filters/nav | backend-gap | Forward-only paging | Counters endpoint | Omit counts; endless/forward paging | Yes | No |
| FP02-G3 | No autocomplete/suggestions | `searchQuerySchema` (q 2–120, submit-only); FP-12 SearchBox; openapi zero-hit | Search is submit-only | backend-gap | Full search submit | Suggest endpoint | Submit-only + latest-wins + keep-query retry | Yes | No |
| FP02-G4 | No price/popularity sort | `SORT_FIELDS` name/created_at; `SEARCH_SORTS` relevance/newest; min/maxPrice filters exist | Cannot sort by price or bestsellers | backend-gap | Name/newest/relevance sorts + price-range filters | Sort keys | Expose only supported sorts; filters for price range | Yes | No |
| FP02-G5 | No reviews/related/favorites/restock | Route inventory (no routes); FP-13 §1; openapi zero-hit | PDP has no social/related modules | backend-gap | Detail + variants + images + stock | Review/relation system | Omit modules; no fake content | Yes | No |
| FP02-G6 | No batch endpoints | Route inventory (per-row ops only) | No bulk admin actions | backend-gap | Per-row mutations | Batch protocol | Per-row flows + confirm | Yes | No |
| FP02-G7 | No online payments/refunds (COD-only scope retained) | `orderCreateSchema` (no payment fields); Q-PAY; openapi zero-hit | Checkout stays payment-neutral | product-decision | Order without payment step | Payment provider scope | Payment-neutral checkout; COD display convention only | Yes (scope decision Q002 open) | No |
| FP02-G8 | No OTP/password-reset; no profile PATCH; no session list | Auth routes (register/session/password only); FP-11.7 §17; openapi zero-hit | Account limited to session/password/addresses/orders | backend-gap | Register/login/logout/password/change; address CRUD | OTP/reset/profile/session-list | Render only supported; no fake UI (G1–G4/B1) | Yes | No |
| FP02-G9 | No binary image upload (URL/metadata only) | Image fields `max(500)` strings; FP-11.8.2; openapi zero-hit | Admin images are URL/metadata flows | backend-gap | Metadata attach + gallery fallback | Upload pipeline/CDN | URL/metadata + placeholder discipline | Yes | No |
| FP02-G10 | No CSV import/export; no scale integration | Route inventory; L5 accepted; openapi zero-hit | No bulk/scale workflows | backend-gap | Manual per-row ops | Bulk/scale scope | Manual flows | Yes | No |
| FP02-G11 | No delivery tracking/notifications/zones/drivers | Fulfillment 12 routes (states only); FP-13 §1; openapi zero-hit | Tracking UI limited to order state + actuals | backend-gap | State display + requested-vs-actual-vs-final | Tracking/notify stack | State + outcome messages | Yes | No |
| FP02-G12 | No metrics/dashboard APIs (honest dashboard only) | FP-11.8 D43; FP-11.11 B-row; openapi zero-hit | Admin dashboard shows operational lists, not analytics | design-constraint | Lists + states | Analytics backend | Operational lists; no fabricated numbers | Review acceptance | No |
| FP02-G13 | No guest order *list*; per-order credential only | `guest-access.ts` (per-order bearer); no guest-list route | Guests track per-order links, not history pages | backend-gap | Per-order read/cancel/decide | Guest listing | Per-order links + credential safekeeping UX | Yes | No |
| FP02-G14 | Promo mid-cart expiry has no event stream | G-P1 (FP-11.11 §C); promotions engine | Expiry learned at reprice/estimate/create | design-constraint | Re-read-driven freshness | Events/push | Reprice/estimate freshness copy | No (constraint) | No |
| — | D39 lost-credential | Resolved via staff-assisted design (FP-11.11 §C) | Recovery path exists | — | Rotate/revoke + buckets + replay | — | Documented UX | No (closed) | No |
| — | L1/L2/L4/L5; L3/C-UNIT; G5; Q-PAY; C-NAME; D41/D44 | Per FP-11.11 §C (25 rows) | As registered | — | As registered | — | As registered | As registered | No new |

Nothing above is converted into a backend work request; impact on frontend scope is recorded first per mandate.

## 6. Brand-to-backend consistency matrix

| Brand/product principle | Backend capability required | Evidence | Current support | Frontend/content implication |
|---|---|---|---|---|
| وضوح الأسعار | Variant price basis + commercial snapshots + estimate-vs-creation authority | §3 pricing/estimate/create rows; `validation.ts:53-67` | Supported (static) | Display from server responses; pre-prep ≈ estimate labeling; post-prep actuals; never client totals as authority |
| شفافية العروض | Promotion rules + application + coupon evaluability | §3 promos row; engine + estimate | Supported, bounded (no feed/events) | Advertise only live-response discounts; expired offers vanish silently; no "offers page" beyond derivable content |
| وضوح التوفر | Inventory reads + mutation-time checks + OOS visibility | §3 inventory/cart rows; FP-11.10 #1 | Supported | `غير متوفر حاليًا` stays discoverable with disabled add; unknown-stock never labeled OOS |
| وضوح الوحدات والأوزان | PIECE/KG/GRAM sale boundary + step presets + actuals | `productUnitSchema`; `writes.ts:76-86`; FP-11.8.2 | Supported | Step-exact selectors; LITER/ML only as package-size metadata text, never sale units |
| سهولة طلب البيت | Cart lifecycle + merge + addresses + estimate + idempotent create | §3 cart/estimate/create/address rows | Supported | Full journey renderable; login never auto-merges; guest inline address vs saved address never mixed |
| متابعة الطلب | Order reads + cancel + guest credential + fulfillment states | §3 order/guest/fulfillment rows | Supported, bounded (no guest list, no tracking API) | Customer history + per-order guest links; state + actuals display; no tracking-timeline invention |
| معالجة غير المتاح | Unavailable marking + replacement propose/decide + READY gate + L1 short-ship | Fulfillment/replacement rows; FP-11.8.3 | Supported | Choices + outcome messages (requested vs actual vs final); short-ship honesty, no auto-substitution claims |
| نبرة محلية مألوفة | No backend dependency (content concern) | BRAND §§6–7; §2.3 | N/A (design) | Egyptian Arabic tone within traits; terminology review for weights/units |
| "الأرخص/الأسرع/الأكبر" | Would need research + benchmark evidence | BRAND §2 (no research); §5 gaps | Unsupported as fact | Forbidden claim class; value-fair framing instead |

No promise depends on a missing operation: transparency/ease promises are satisfiable with supported capabilities under the documented bounds. No promise was reworded to hide a gap.

## 7. Consistency with prior specs (no redefinition)

- FP-10: traits → token/type/layout contracts (§3 brand principles); palette LOCKED reused; Cairo still owner-open; logo still reference-only. No conflict.
- FP-11: journeys and D-decisions (D02–D48) preserved; FP-11.10 error semantics and FP-11.11 registers reused by reference. One historical note (FP-11.7 §7 D43 display text) was already corrected in its own closure task — not reopened.
- FP-12: component contracts (server-authoritative data, no client pricing) consistent with §§3–4 here. No new component defined.
- FP-13: normative per-route matrix untouched; §3 here is a brand-relevant slice with pointers. Pagination (§1.1), comm layer (§3), auth separation (§4), idempotency matrix (§5) adopted as-is: cart-add NOT idempotent, order-create same-key dedup VERIFIED (static), estimate repeatable-but-unstable, login/register/admin-mutations NOT idempotent.
- FP-14: state/cache/session/retry rules adopted as-is (zustand available-unused; no cache directives; server-only discipline; re-read-first; 429 backoff). No cache/retry rule changed.
- FP-16/20: test stack (vitest+RTL+Playwright, install deferred) and WP roadmap untouched; FP-20 stale-numbering note resolved in §1 row 10 without changing FP-20.
- Frozen rules kept: money/stock/permission authority server-side; `PIECE/KG/GRAM` sale units; `LITER/ML` metadata-only; COD-only scope; 30d/8h/90d lifetimes; short-ship L1; guest-credential separation; no OTP/payments/upload invention.

## 8. Acceptance & final status

Brand acceptance: source found + verified (§1 rows 2–8); LOCKED decisions preserved verbatim; axes operationalized as derivation (§§2.2–2.3); promise/differentiation/emotional/no-gos recorded (§§2.4–2.7); linking rules + review criteria usable (§§2.8/2.10); decisions vs derivations vs open distinguished (§2.9); conflicts resolved openly (§1 rows 9–10).

Capability acceptance: brand-relevant operations inventoried with real method+path+contract+impl refs (§3); auth/RBAC per evidence (§3 + §4); request/response essentials summarized with source pointers (schemas not bulk-copied); pagination per-endpoint family recorded; errors/failures/gaps recorded (§§4–5); OpenAPI-vs-code mismatches: none beyond already-recorded C-NAME (corrected) and estimate-404-vs-creation-422 (intentional dry-run vs commit); unsupported features explicitly marked, never shown as available; no invented API/rule.

Implementer questions answered: (1) the store must feel like a trustworthy, warm, organized, practical, calm local hypermarket speaking plain Egyptian Arabic with noise-free fair-value pricing; (2) the backend capabilities, bounds, and failure behaviors above (with FP-13/FP-11.10/FP-11.11 as normative detail) define exactly what the UI may do and how it must behave on success or failure.

**Final status: `FP-02 COMPLETE WITH EXPLICIT LIMITATIONS`** — limitations = static-review-only evidence (no live run this task); unsupported lists in §5; non-blocking residuals in §2.9.

---

*End of FP-02 — specification-only, no implementation.*
