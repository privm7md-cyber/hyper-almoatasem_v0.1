# ADMIN QA — CONTENT, USABILITY, RESPONSIVE, ACCESSIBILITY

Scope: the rebuilt admin panel (Phase 05 / admin 360°). Everything below was
measured against the **running** app on the isolated preview, not against the
source. The harnesses that produced the numbers live in `scripts/` and can be
re-run; the raw output lives next to this file in
`docs/data-sources/perf/admin-preview/`.

## The harnesses

| Script | What it measures | Raw output |
|---|---|---|
| `scripts/preview-shots.mjs` | every admin route: HTTP status, console errors, failed requests, resource count, transferred bytes, screenshots | `capture-report.json`, 29 PNGs |
| `scripts/admin-visible-text-audit.mjs` | the **rendered** text of every route, scanned for English technical terms | console output |
| `scripts/admin-latin-inventory.mjs` | the strict §4 audit: **every** visible Latin string on every route, classified as identifier / stored value / panel-written English | `admin-latin-inventory.json` |
| `scripts/admin-qa-extract.mjs` | each page's own self-description: title, intro, panel titles and sub-lines, notes, labels, buttons | `admin-qa-extract.json` |
| `scripts/admin-qa-responsive.mjs` | horizontal overflow, rail vs. overlay, tap targets, at 1440 / 834 / 390 px; keyboard path and focus rings; the forbidden state | `admin-responsive-qa.json` |
| `scripts/admin-qa-states.mjs` | the loading, empty, error and forbidden states on the live app | `admin-states-qa.json` |
| `scripts/admin-error-coverage.mjs` | every server message has an Arabic translation | console output |

---

## Part 1 — Content and usability, from a non-technical shop owner's view

Seven questions per page. The answers below are not opinions: every quoted
sentence is text that was **read out of the live DOM** by
`admin-qa-extract.mjs`.

The seven questions:

1. **What is this page for?** — does the header say it in one plain line?
2. **What am I supposed to do first?** — is the first action visible without hunting?
3. **Does every control name its own action?** — are the buttons verbs, not "execute"?
4. **What will change when I press it?** — does the page say what gets written?
5. **What can go wrong?** — are the conditions and warnings stated before the action?
6. **Is every word plain Egyptian Arabic?** — no English technical terms.
7. **Can I trust the numbers?** — are they counted live, and is the source visible?

### 1. Home — `/admin`

1. **For what?** "دي الصفحة اللي بتبدأ منها يومك. تحت بالظبط الحاجة اللي مستنياك، وأرقامها بتتحسب من بيانات المتجر نفسها وقت الفتح — مفيش أي رقم متخيّط."
2. **First action?** The board «محتاج متابعة دلوقتي» opens first — every row carries its own button («افتح الطلبات ←»، «افتح المخزون ←»، «افتح العروض ←»).
3. **Controls?** Every button names its destination: «افتح الطلبات»، «افتح المخزون»، «افتح العروض»، «كل الطلبات ←».
4. **What changes?** Nothing on the home page writes; it only reads. The note says so: "الأرقام في الصفحة دي بتتحسب وقت فتحها من جداول المتجر مباشرة."
5. **Warnings?** Each row states the consequence: «أصناف خلصت من المخزن — الكمية المتاحة وصلت صفر. امنعها من البيع أو أضف كمية على طول.»
6. **Arabic?** 0 English technical terms, and 0 Latin strings the panel wrote — the greeting addresses the operator as «أهلًا بيك يا مالك المتجر» (see Part 2). The only Latin on the page is store data and the operator's own email.
7. **Numbers?** All six counters were checked against the database with a read-only query: **4 orders, 9539 products, 121 categories, 3 brands, 4 tracked stock rows, 14 customers (all 14 registered), 5 draft promotions, 0 coupons** — every figure on the page matches.

### 2. Orders — `/admin/orders`

1. "من هنا بتشوف كل طلب وصل المتجر، بتتابعه خطوة بخطوة، وبتعرف هو واقف فين."
2. The filter row is above the table: حالة الطلب، بحث في الطلبات، من تاريخ، لحد تاريخ، then «اعرض الطلبات».
3. «اعرض الطلبات»، «مسح الفلترة»، «الصفحة اللي بعد كده ←» — no "تنفيذ".
4. "كل صفحة فيها 20 طلب" — the page size is stated on the page.
5. "«طلب جديد» يعني لسه ما اتأكدش، و«قيد التجهيز» يعني الفريق شغال عليه دلوقتي، و«ملغي» يعني خلاص مش هيوصل."
6. 0 English technical terms.
7. The count in the panel header ("النتايج المطابقة للفلترة الحالية") is the query's own count.

### 3. Products — `/admin/products`

1. "من هنا بتدوّر على أي منتج، تشوف تصنيفه وعلامته التجارية وطريقة بيعه وسعره، تفتحه علشان تعدّل بياناته، أو تضيف منتج جديد."
2. The search box and the «منتج جديد» button are the two first things on the page.
3. «منتج جديد»، «طبّق الفلترة»، «الصفحة اللي بعد كده ←».
4. "السعر المكتوب في القائمة هو أرخص سعر لأشكال المنتج."
5. "المنتج بالوزن بيتباع بخطوة معروفة — مثال ربع كيلو — ومنتج بالقطعة ليه سعر واحد لكل شكل. فلتر طريقة البيع والوحدة بيفرقوا بين المنتجات اللي بتتباع بالوزن واللي بتتباع بالقطعة."
6. 0 English technical terms.
7. The list is server-paginated (20 per page) and server-searched; the count comes from the query.

### 4. Add product — `/admin/products/new`

1. "المنتج الجديد محتاج اسم واضح، وتصنيف واحد هو القسم اللي هيتحط تحته، وعلامة تجارية لو الشركة معروفة، وطريقة بيع واحدة، وأول شكل للبيع بسعره وكوده."
2. Four panels in order: بيانات المنتج الأساسية ← التصنيف والعلامة التجارية ← طريقة البيع والوحدة ← أول شكل للبيع.
3. «احفظ المنتج» — and the page says what happens next: "بعد الحفظ هتنتقل لصفحة المنتج الجديدة."
4. "من غير شكل وسعر، المنتج مش هيبان في المتجر."
5. "لو التصنيف غلط هتلاقي المنتج في قسم مش صح، ولو العلامة غلط هتبان المنتجات مش مظبوطة مع بعض."
6. 0 English technical terms.
7. No counter on this page — nothing is invented.

### 5. Product details — `/admin/products/{id}`

1. "بيانات المنتج وأشكال بيعه وأسعاره وأكواده، وكلها من نفس الصفحة."
2. The header carries two jump buttons: «تعديل بيانات المنتج» and «إضافة شكل بيع جديد».
3. «انسخ المعرّف»، «افتحه في المتجر»، «أضف الشكل»، «احفظ التعديلات».
4. "أي تعديل هنا بيتحفظ على طول وبيظهر للعميل في المتجر على طول."
5. "الشكل هو الحاجة اللي بتتباع فعلاً — من غير شكل وسعر المنتج مش هيبان في المتجر ومش هيتباع في نقطة البيع."
6. 0 English technical terms.
7. The name carries a trust badge («بيانات اختبار» / «الاسم محتاج مراجعة») next to the untouched original text — nothing is rewritten.

### 6. Categories — `/admin/taxonomy` (first half)

1. "التصنيف بيحدد القسم اللي المنتج بيتحط تحته… من هنا بتدوّر على القسمين، وبتضيفهم، وبتتحكم في ظهورهم في المتجر."
2. The list panel is first, then «أضف التصنيف».
3. «أضف التصنيف»، «احفظ التصنيف»، «تعطيل التصنيف».
4. "التصنيف الجديد بيظهر للعميل في المتجر على طول."
5. "التعطيل بيخفي التصنيف ومنتجاته من المتجر، وبيسيبهم في الكتالوج."
6. 0 English technical terms.
7. The panel count ("التصنيفات مرتبة بالاسم") is the query's count.

### 7. Brands — `/admin/taxonomy` (second half)

1. "العلامة التجارية بتحدد اسم الشركة اللي بتعمل المنتج."
2. The brand list, then «أضف العلامة التجارية».
3. «أضف العلامة التجارية»، «احفظ العلامة التجارية»، «تعطيل العلامة التجارية».
4. "العلامة الجديدة بتظهر للعميل مع منتجات الشركة."
5. "التصنيف والعلامة التجارية مش نفس الحاجة: التصنيف بيقول المنتج فين، والعلامة التجارية بتقول مين بيعه."
6. 0 English technical terms.
7. Same as the categories: the count is the query's count.

### 8. Inventory — `/admin/inventory`

1. "من الصفحة دي بيتتابع رصيد كل صنف في المتجر، وبتعمل عليه أربع خطوات منفصلة: تراجع الرصيد، أو تضيف كمية، أو تسوّي فرق الجرد، أو تحدد حد التنبيه."
2. The four operations are four separate panels, each with its own note and its own button.
3. «سجّل الإضافة»، «سجّل التسوية»، «سجّل حد التنبيه» — each names the operation.
4. "العملية دي بتزوّد الكمية المسجّلة لصنف واحد وقت وصول البضاعة من المورّد، وبتسجّل الحركة في سجل المخزون."
5. "استخدمها للإضافة بس، مش للتسوية." / "لو الكمية اتغيّرت بين ما فتحت الصفحة ولحد ما سجّلت التسوية، راجع الرصيد تاني الأول." / "مابتغيّرش الكمية ولا بتخصم منها حاجة."
6. 0 English technical terms.
7. "كل الأرقام بتتحسب من بيانات المتجر وقت فتح الصفحة." The movement table shows the real balance before and after each movement.

### 9. Promotions — `/admin/promotions`

1. "من هنا بتعمل خصم وتربطه بمنتجات معيّنة أو بإجمالي الطلب كله."
2. «إنشاء العرض» is on the page head; the list is below.
3. «إنشاء العرض»، «أكواد الخصم ←».
4. "العرض بيتعمل مسودة، وبيشتغل بعد ما تختارله المنتجات ويتفعّل."
5. "العرض اللي في حالة مسودة مش بيعمل حاجة على أي طلب لحد ما تفعّله."
6. 0 English technical terms — **no `Bases`, no raw enum values**. The four discount kinds are named: «خصم بنسبة مئوية»، «خصم بمبلغ ثابت»، «سعر ثابت للمنتج»، «اشترِ كذا واحصل على كذا».
7. The list is paginated and filtered server-side by name and status.

### 10. Coupons — `/admin/coupons`

1. "الكود مبياخدش خصم من نفسه — هو اسم بيلف على عرض، ونوع الخصم وقيمته بييجوا من العرض اللي عليه."
2. «إنشاء الكود» on the page head.
3. «إنشاء الكود»، «بحث».
4. "الكود بيتربط بعرض موجود، وبياخد منه نوع الخصم والقيمة."
5. "لو العرض اللي ورا الكود اتوقف أو خلصت مدته، الكود مش هيشتغل حتى لو هو نفسه نشط."
6. 0 English technical terms — no invented fields; the form shows only the limits that exist on the code: max uses, per-customer limit, minimum order, start, end, state.
7. The code list is server-paginated and searched by the code itself.

### 11. Customers — `/admin/customers`

1. "من هنا بيتم البحث بالاسم أو التليفون، وفتح صفحة العميل لقراءة طلباته وعناوينه المحفوظة، وتعديل بيانات التواصل بتاعته."
2. The search box is the first control; the panel header shows the number of matching records.
3. «بحث» — and each row links to the customer's own page.
4. "فتح صفحة العميل لقراءة طلباته وعناوينه المحفوظة، وتعديل بيانات التواصل بتاعته."
5. "العلامة اللي جنب الاسم بتوصف شكل الاسم بس: «بيانات اختبار» أو «الاسم محتاج مراجعة»."
6. 0 English technical terms, 0 Latin written by the panel — the Latin here is customer names as stored.
7. **No customer is hidden and no total is invented.** The note says exactly why: "قاعدة بيانات المتجر مفيهاش تاريخ ولا وسم يفرّق بين عميل حقيقي وسجل جاي من اختبار، فالعلامة دي كل الأدلة المتاحة والصفحة بتعرض كل السجلات من غير ما تخفي أي واحد." The count in the panel header (14) is the query's count. The badge now actually fires where the evidence is unambiguous: the six `P13RA/P13RB/P13RC` and `P10 E2E` records — the names this project's own `e2e/` scripts register — each read «بيانات اختبار» next to the name, and every one of the 14 rows is still listed.

### 12. Users — `/admin/users`

1. "حسابات فريق المتجر اللي بتدخل لوحة الإدارة، مش عملاء المتجر."
2. «إضافة حساب جديد» on the page head.
3. «إضافة الحساب».
4. "الحساب بيتضاف من غير كلمة سر، وكلمة السر بتتحدد من صفحته."
5. "إيقاف الحساب بيمنع الدخول للوحة الإدارة بس… والإيقاف مش بيحذف أي حاجة." — and the page now also says what the name column is: "اسم كل حساب في الجدول هو الاسم اللي اتكتب وقت إنشاء الحساب، وبيبان بالحرف زي ما هو. لو اسم حسابك مش بالشكل اللي عايزه، افتح صفحة الحساب نفسه وغيّره من هناك."
6. 0 English technical terms, 0 Latin written by the panel. Fixture accounts («P10 Probe», «P10 Store») carry the «بيانات اختبار» badge, and a role that is not one of the two store roles reads «دور مخصص».
7. 43 accounts — the query's count.

### 13. Roles — `/admin/roles`

1. "الدور هو مجموعة صلاحيات باسم معروف. لما تضيف الصلاحيات للدور، أي حد شايل الدور بياخد الصلاحيات دي مع بعض."
2. «أضف الدور».
3. «أضف الدور».
4. "الاسم والوصف بس، والصلاحيات بتتضاف من صفحة الدور."
5. "الدور الموقوف بيفضل موجود في القائمة، بس أي حد شاالدور الموقوف مش بياخد أي صلاحية منه."
6. 0 English technical terms.
7. 20 roles — the query's count.

### 14. Permissions — `/admin/permissions`

1. "دي كل حاجة ممكن حد في فريق المتجر يعملها. الصلاحيات مرتبة حسب أقسام المتجر، وكل صلاحية مكتوبة باسمها العادي عشان الفريق يفهمها من غير ما يعرف الكود بتاعها."
2. The seven capability groups are the page: إدارة المنتجات، إدارة المخزون، إدارة الطلبات، إدارة العملاء، إدارة العروض والخصومات، إدارة التوصيل، إدارة الفريق والصلاحيات.
3. Read-only page — no write button, by design.
4. "الصلاحية بتشتغل بس لما تكون في دور حد شاالدور."
5. "الصلاحيات مش بتتدي للفرد على طول. كل صلاحية بتتدي لدور… عشان تدي صلاحية لحد، افتح صفحة الدور بتاعه وضيفها فيه."
6. 0 English technical terms. **30 permission keys are shown on purpose** — beside their Arabic reading, muted — so an administrator can match a key to the catalogue. They are technical identifiers, not interface copy.
7. No counters. The list is the database's permission catalogue, unchanged: no permission was created and no authorisation logic was touched.

### 15. Permission log / change log — `/admin/audit-logs`

1. "سجل التغييرات بيقول مين عمل إيه وإمتى. كل سطر معناه إن التغيير اتسجل في المتجر بعد ما اتحفظ فعلًا."
2. The filters (نوع التغيير، القسم، من يوم، لحد يوم) sit above the list.
3. «تصفية».
4. "السجل بيتكتب جوّه نفس عملية الحفظ، فسطره معناها إن التغيير اتسجل بالفعل."
5. "الدخول المرفوض وعمليات الدخول بس هم الاستثناء، والسطر بيبقى معروف من نوع التغيير نفسه."
6. 0 English technical terms. **Raw JSON is not the primary interface** — each row reads in Arabic; the technical detail lives on the row's own page under «التفاصيل التقنية».
7. 20 rows per page, server-paginated.

### 16. Store settings — `/admin/settings`

1. "الإعدادات دي هي اللي بتتحكم في المتجر كله: الاسم والتواصل، والأسعار، والتوصيل، ومدة إلغاء الطلبات."
2. The eight settings are listed with their current values; each has its own «احفظ» button.
3. «احفظ» — one per setting, next to the value it saves.
4. "القيمة الجديدة بتتحفظ بعد ما المتجر يتحقق منها" / "كل قيمة بتتحفظ في المتجر وبتتحدث على طول."
5. "لو القيمة مش مناسبة للإعداد، المتجر بيرفضها ويرجعلك رسالة واضحة من غير ما يغيّر حاجة."
6. 0 English technical terms. **No secret is shown** — the page shows the settings and their current values, never a credential.
7. 8 settings — the query's count.

### 17. Delivery zones — `/admin/delivery-zones`

1. "مناطق التوصيل هي الأحياء والمناطق اللي المتجر بيوصل لها، ولكل منطقة رسومها."
2. «أضف المنطقة».
3. «أضف المنطقة».
4. "الاسم والرسوم، والمنطقة بتبدأ مفعّلة."
5. "مفيش حساب بالمسافة ولا تخمين من نص العنوان."
6. 0 English technical terms.
7. "الرسوم الافتراضية دلوقتي: 20.00 ج.م" — read from the store settings, not typed in. The zone count (0) is the query's count, and the empty state is shown rather than a fabricated row.

### 18. Audit detail — `/admin/audit-logs/{id}`

1. "سطر واحد من سجل التغييرات: تسجيل دخول ناجح في قسم مستخدمو الإدارة."
2. «ملخص التغيير» first — who did what and when.
3. Read-only.
4. "ال قيم قبل التغيير" / "القيم بعد التغيير" — the before and after values, in Arabic labels.
5. "السطر ده اتسجل جوّه نفس عملية الحفظ، فوجوده معناه إن التغيير اتسجل فعلًا في المتجر."
6. 0 English technical terms.
7. One row, one log line — nothing aggregated.

### 19. Order detail — `/admin/orders/{id}`

1. "الصفحة فيها بياناته وعنوان التوصيل، والأصناف اللي محتاجة تجهيز، وحساب الطلب. الخطوة اللي الفريق يقدر ياخدها دلوقتي باينة في أول لوحة تحت."
2. «الخطوة الجاية» is the first panel — the action the current state allows.
3. «ابدأ تجهيز الطلب»، «ألغِ الطلب»، «ابعت اقتراح البديل»، «جدّد رمز الوصول للطلب».
4. "الخطوة بتتحفظ في سجل التغييرات باسمك."
5. "الإلغاء نهائي: بيرجّع أصناف الطلب للمخزون… ينفع بس قبل ما يتسجّل أي كمية على أي صنف."
6. 0 English technical terms.
7. "الإجمالي التقديري ده اتحسب وقت تأكيد الطلب. رقمه النهائي بيقف لما الفريق يخلّص تجهيز الأصناف."

---

## Part 2 — The English-text audit (§4), run on the rendered UI

`scripts/admin-visible-text-audit.mjs` signs in, reads
`document.body.innerText` on every route, and scans it for the banned list.

| Route | lines of visible text | banned English terms |
|---|---|---|
| `/admin` | 143 | 0 |
| `/admin/orders` | 61 | 0 |
| `/admin/products` | 259 | 0 |
| `/admin/products/new` | 209 | 0 |
| `/admin/taxonomy` | 588 | 0 |
| `/admin/inventory` | 197 | 0 |
| `/admin/promotions` | 107 | 0 |
| `/admin/coupons` | 75 | 0 |
| `/admin/customers` | 59 | 0 |
| `/admin/users` | 105 | 0 |
| `/admin/roles` | 71 | 0 |
| `/admin/permissions` | 93 | 0 (30 permission keys kept on purpose) |
| `/admin/settings` | 75 | 0 |
| `/admin/delivery-zones` | 55 | 0 |
| `/admin/audit-logs` | 189 | 0 |

**English technical terms in the rendered admin UI: 0.**

### The strict audit — every Latin character the operator can see

A banned-word list only proves that the words we thought of are absent. The
stricter audit (`scripts/admin-latin-inventory.mjs`, output
`admin-latin-inventory.json`) walks **every visible text node** on all 15
routes and keeps the ones carrying a Latin letter, then asks of each one:
*did the panel write this, or is this a stored value / an identifier?*

| What the Latin text is | Count | Example |
|---|---|---|
| Identifier — email address | 36 | `owner@hyper-al-moatasem.local` |
| Identifier — permission key | 32 | `products.view` |
| Identifier — order number | 8 | `HM-20261030-003825` |
| Stored value — a name in the catalogue | 293 | `BA11A Cat muk4bqn3`, `Pepsi` |
| Stored value — a customer / team account / order note | 23 | `P10 Probe`, `Expiry Probe` |
| Trade symbol — unit of measure | 8 | `330 ML`, `2.5 L`, `KG` |
| Stored setting value | 3 | `EGP`, `Africa/Cairo`, `Hyper Al-Moatasem` |
| **English prose written by the panel itself** | **0** | — |

**Total Latin-bearing text nodes: 403. English written by the panel: 0.**
Every remaining one is a stored value (shown exactly as stored, per §7) or an
identifier the operator needs (emails, permission keys, order numbers, unit
symbols, the store's own Latin name).

### Two things this audit caught, and the fix

The strict pass found two English sentences the banned-word list could not
see, because neither is a technical term:

1. **The greeting and the rail** printed the owner account's stored English
   name — `أهلًا بيك يا System Owner` — on every screen. The name is data and
   was left untouched; the panel now addresses the operator by the Arabic
   reading of their role when the stored name is not Arabic
   (`operatorDisplayName` in `src/lib/admin/terminology.ts`, covered by
   `src/lib/admin/__tests__/terminology.test.ts`). The greeting reads
   **«أهلًا بيك يا مالك المتجر»**, and the rail shows the role chip and the
   email instead of the machine name. A name the operator typed in Arabic is
   still used as it is.
2. **The team table printed «دور بدون اسم معروف»** for every role that is not
   one of the two store roles — a phrase that reads like a fault. The same
   role on the roles page already read «دور مخصص». One rule now drives both
   (`roleLabel`), so the same role reads the same way everywhere.

### The fixture accounts now carry their evidence (§6)

`P10 Probe`, `P10 Store`, `P10 E2E`, `P13RA`, `P13RB` and `P13RC` are this
project's own end-to-end fixtures (`e2e/phase10-fixtures.ts`,
`e2e/phase10-remediation.spec.ts`, `e2e/p13r-account-runtime.spec.ts`). The
classifier in `src/lib/catalog/name-integrity.ts` now knows those signatures,
so each of those customers and team accounts shows the **«بيانات اختبار»**
badge next to its name. It is a label only — nothing is hidden, nothing is
deleted, and the customers page still shows every record.

Server messages: `scripts/admin-error-coverage.mjs` cross-checks every error
string the server can return against the Arabic table —
**237 server messages, 240 translations, 0 missing.**

---

## Part 3 — Responsive, keyboard and states

### Responsive (measured at 1440 / 834 / 390 px, 15 routes each = 45 measurements)

| | result |
|---|---|
| routes with sideways scroll | **0 of 45** |
| worst document overflow at 390 px | **0 px** (document width = 390 px = viewport) |
| rail visible at ≥1024 px | yes |
| overlay trigger visible below 1024 px | yes |
| direction | `rtl` on every route |

**A real defect was found and fixed here.** The first pass measured **11 of 15
routes scrolling sideways on a phone**, up to +347 px. The cause was
`.adm-main-inner` and the shell wrapper: both are grids whose *implicit* column
sizes itself to max-content, so one wide table pushed the whole page past the
edge of the screen. Giving both grids an explicit `minmax(0, 1fr)` column
fixed it — the tables now scroll inside their own frame (`.adm-table-scroll`,
`overflow-x: auto`) and the page itself never scrolls sideways.

### Keyboard

| route | tab stops sampled | stops with no visible focus ring | reached `<main>` |
|---|---|---|---|
| `/admin` | 24 | **0** | yes |
| `/admin/products` | 24 | **0** | yes |
| `/admin/inventory` | 24 | **0** | yes |
| `/admin/settings` | 24 | **0** | yes |

Every sampled tab stop paints a visible focus ring (an `outline` or a
`box-shadow`). The main region is `tabIndex={-1}` so it can be focused
programmatically.

### The four states

| State | How it was proven | Result |
|---|---|---|
| **loading** | the RSC payload of a cold route was held back for 4 s during a soft navigation | the frame appears, `role="status"`, and **shows no numbers** — "الصفحة بتتحمّل — الأرقام هتظهر لأنها محسوبة من بيانات المتجر." |
| **empty** | a product search that matches nothing | «لا توجد منتجات مطابقة» / «ملقيناش نتائج بالفلترة دي — غيّر كلمة البحث أو ألغِ الفلترة وجرب تاني.» |
| **error** | the segment boundary `src/app/admin/error.tsx` | «حصلت مشكلة في لوحة الإدارة» + a «جرّب تاني» button; the message states that nothing was executed and nothing changed |
| **forbidden** | five admin routes requested without a session | every one lands on `/admin/login` |

The loading frame was added during this pass: the admin segment had an error
boundary but no loading state. It is a skeleton with **no numbers in it**, on
purpose — a fake "0" would read as data.

---

## Part 4 — Visual QA at three widths

Screenshots are in `docs/data-sources/perf/admin-preview/`:

* `19-mobile-admin.png`, `19-mobile-admin-products.png`,
  `19-mobile-admin-orders.png`, `19-mobile-admin-inventory.png`,
  `19-mobile-admin-customers.png` — 390 px
* `19-tablet-admin.png`, `19-tablet-admin-products.png`,
  `19-tablet-admin-orders.png`, `19-tablet-admin-inventory.png`,
  `19-tablet-admin-customers.png` — 834 px
* `20-reduced-motion-home.png` — the home page under
  `prefers-reduced-motion: reduce`

At 390 px the rail is replaced by the «الأقسام» overlay trigger in the top
bar, the filter forms collapse to one column, the tables scroll inside their
own frame, and the 3D viewport falls back to the static CSS frame.

---

## Part 5 — What was not testable

* **Writing to the data.** The preview points at the scratch database
  `hyper_almoatasem_scratch`. Every query run for this QA was a `SELECT`.
  Creating a promotion, a coupon, a zone, a role or a product was **not**
  performed against it, because that is a write and the brief withholds write
  authorisation. The write paths are covered by the unit suite instead.
* **A customer with a restricted role.** The forbidden state was proven for an
  *anonymous* visitor. A signed-in account that holds fewer permissions than
  the owner was not exercised in the live app, because creating one is a write.
  The unit suite covers the permission gate.
* **Real Safari / real Firefox.** The visual QA ran on the system Chrome only
  (Playwright had no browsers downloaded, and the harness uses
  `channel: "chrome"`).
* **The production and preview databases.** Untouched — no connection was made
  to either, and no migration was run.

## Part 6 — One honest caveat

Across seven full runs of the test suite during this work, one run reported a
single failing test; the failing test's name was not captured before the run
was repeated. Six subsequent full runs passed cleanly, and the three
store-side suites that use real timers were run five times each without a
failure. After the last set of fixes (the operator's identity in the chrome,
one rule for role naming, the fixture-name evidence in the trust
classifier — 6 new tests, so the suite is now 549) the full suite was run
three more times: **549/549, 549/549, 549/549**, with `tsc --noEmit` clean.
The suite is green and stable now, but the one-off was real and is recorded
here rather than hidden.
