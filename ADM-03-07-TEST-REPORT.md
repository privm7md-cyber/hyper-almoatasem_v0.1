# ADM-03 → ADM-07 — TEST REPORT
### تقرير الاختبارات

- **المشروع:** Hyper Al-Moatasem — هايبر المعتصم
- **النطاق:** ADM-03، ADM-04، ADM-05، ADM-06، ADM-07
- **تاريخ التنفيذ:** 12 Nov 2026
- **قاعدة البيانات:** **صفر عمليات كتابة.** كل الاختبارات إما معزولة (mocks) أو تقرأ من fixtures. لا يوجد اختبار E2E حي على `hyper_almoatasem`، ولا يُدّعى ذلك.

---

## 1. النتيجة النهائية

```
Test Files  107 passed (107)
Tests      1815 passed (1815)
Duration   ~161s
```

الأمر: `npx vitest run` (إعداد `vitest.config.ts` — jsdom + alias `@` + stub لـ`server-only`).

**فحص الأنواع**: `npx tsc --noEmit -p tsconfig.json` → نظيف (exit 0).
**بناء Next.js**: `npx next build` → **Compiled successfully** (exit 0) — وفيه المسارات الجديدة: `/admin/promotions/[id]` و`/api/admin/promotions/[id]/preview`.

## 2. التوزيع حسب المرحلة

| المرحلة | ملفات الاختبار | عدد الاختبارات | النتيجة |
|---|---|---|---|
| ADM-03 (الكتالوج والمنتجات) | 15 | 405 | ✅ |
| ADM-04 (المخزون) | 6 | 269 | ✅ |
| ADM-05 (الطلبات) | 11 | 163 | ✅ |
| ADM-06 (العملاء) | 1 (+ ما قبله) | 6 | ✅ |
| ADM-07 (العروض) | 3 (+ كوكيبONS/إعدادات) | 27 ضمن المجموعة | ✅ |
| عبر المراحل (أمان، صلاحيات، a11y، dashboard، مستخدمون، إشعارات) | الباقي | الباقي | ✅ |

## 3. تغطية مصفوفة الاختبارات المطلوبة (Part 7)

### 7.1 المنتجات

| البند | الاختبار | الحالة |
|---|---|---|
| قائمة المنتجات | `catalog.test.tsx` | ✅ |
| تفاصيل المنتج | `product-lifecycle-detail.test.tsx` | ✅ |
| نموذج الإنشاء/التعديل | `catalog-forms.test.tsx` | ✅ |
| PIECE / WEIGHT | `admin-product-list.test.ts` + `product-stock.test.tsx` | ✅ |
| تحقق الباركود | `catalog.test.tsx` | ✅ |
| فلترة القسم/العلامة | `catalog.test.tsx` | ✅ |
| الظهور / الأرشفة / الاستعادة | `lifecycle.test.ts`, `product-lifecycle-detail.test.tsx` | ✅ |
| أهلية الحذف النهائي | `lifecycle-eligibility.test.ts` | ✅ |
| **مطابقة المتجر** | `storefront-parity.test.tsx`, `admin-product-list.test.ts` | ✅ |
| صور المنتج | `product-lifecycle-media.test.tsx` | ✅ |

### 7.2 المخزون

| البند | الاختبار | الحالة |
|---|---|---|
| رصيد معروف / صفر مؤكد / رصيد مفقود / توفر غير مؤكد | `adm04-isolated-adjust-stock.test.ts` + `inventory.test.tsx` | ✅ |
| مخزون منخفض | `inventory.test.tsx` | ✅ |
| دقة الوحدة / الرصيد بالوزن | `adm04-isolated-adjust-stock.test.ts` | ✅ |
| حركة المخزون | `inventory.test.tsx` | ✅ |
| تحقق التسوية | `adm04-isolated-adjustments-route.test.ts` | ✅ |
| منع التسوية المكررة | `adm04-isolated-adjust-stock.test.ts` | ✅ |
| سجل الحركة | `inventory.test.tsx` | ✅ |

### 7.3 الطلبات

| البند | الاختبار | الحالة |
|---|---|---|
| قائمة الطلبات | `orders.test.tsx` | ✅ |
| تفاصيل الطلب | `orders.test.tsx`, `adm05-isolated-orders.test.tsx` | ✅ |
| فلاتر التاريخ | `orders.test.tsx` (DST + يوم مستحيل) | ✅ |
| فلاتر الحالة | `orders.test.tsx` | ✅ |
| الانتقالات الصالحة/غير الصالحة | `src/lib/orders/__tests__/` | ✅ |
| منع التكرار (single-flight) | `adm05-isolated-fulfillment.test.tsx` | ✅ |
| Snapshot السعر التاريخي | `src/lib/orders/__tests__/` + `catalog` | ✅ |
| قواعد الإلغاء | `orders.test.tsx` | ✅ |
| طلبات الضيف | `src/lib/orders/__tests__/` + `guest-access` | ✅ |
| قيود الأدوار | `permission-gate.test.tsx`, `cost-props.test.tsx` | ✅ |

### 7.4 العملاء

| البند | الاختبار | الحالة |
|---|---|---|
| البحث | `adm06-isolated-customers.test.tsx` | ✅ |
| تفاصيل العميل | نفس الملف | ✅ |
| بيانات العناوين | نفس الملف (حقول موجودة فقط) | ✅ |
| الطلبات المرتبطة | نفس الملف (مع/بدون صلاحية) | ✅ |
| عزل الضيف | نفس الملف + `src/lib/customers` | ✅ |
| تعطيل/إعادة التفعيل | `customer-edit-form` + `customers.manage` | ✅ |
| فرض الصلاحيات | نفس الملف | ✅ |
| أهلية الحذف | `customer-edit-form` (بلا حذف نهائي) | ✅ |
| حفظ السجل التاريخي | `deletedAt` + `onDelete: Restrict` | ✅ |
| Audit Trail | `src/lib/api/__tests__/audit*.test.ts` | ✅ |

### 7.5 العروض

| البند | الاختبار | الحالة |
|---|---|---|
| عروض/كوبونات فارغة | `promotions.test.tsx`, `coupons.test.tsx` | ✅ |
| إنشاء أول عرض | `promotions.test.tsx` | ✅ |
| اختيار المنتجات | `adm07-isolated-promotion-detail.test.tsx` | ✅ |
| اختيار الأقسام | `promotion_targets` + `inSubtree` | ✅ |
| نسبة / مبلغ ثابت | `admin-preview.test.ts` | ✅ |
| Buy X Get Y | `promotion-forms` + `promo.buyGet` | ✅ |
| حد أدنى للكمية / لقيمة الطلب | `adm07-isolated-promotion-detail.test.tsx` | ✅ |
| البداية/النهاية + المناطق الزمنية | `promotions.test.tsx` + `date-range` | ✅ |
| الأولوية وفض التعادل | `admin-preview.test.ts` (الأولوية الأعلى يفوز) | ✅ |
| قواعد التراكم | `admin-preview.test.ts` | ✅ |
| **معاينة السعر النهائي** | `admin-preview.test.ts` (20% ⇒ 80.00 من محرك الـcheckout) | ✅ |
| عرض منتهٍ | `promotions.test.tsx` + `adm07-isolated-promotion-detail.test.tsx` | ✅ |
| تحقق API | `admin-preview-census.test.ts` | ✅ |
| عدم تغير السعر الأصلي | `admin-preview.test.ts` (لا `data` في الاستعلامات) | ✅ |
| **لا Fake Preview** | المعاينة تستعمل `evaluateLines`/`evaluateOrderLayer` الحقيقيين | ✅ |

## 4. اختبارات المعاينة الآمنة (Census)

`src/lib/api/__tests__/admin-preview-census.test.ts` — **82 اختبارًا**:

- تعداد كل مسارات الإدارة (75 ملف route، 107 handler، 66 mutation).
- لكل مسار كتابة: **403 قبل أي وصول لقاعدة البيانات** حتى مع ترويسة prefetch مزوّرة.
- كل handler فيه بوابة صريحة (`denyUnless` / `denyUnlessAll` / `adminOrDeny` / `adminOrDenyAll` / `checkPermission` / `requirePermission`).
- نقطة المعاينة الجديدة `GET /api/admin/promotions/[id]/preview` دخلت في العدّاد تلقائيًا لأنها قراءة.

## 5. مشاكل تم اكتشافها وإصلاحها في هذه الجلسة

| # | الاكتشاف | الأثر | الإصلاح | الاختبار الذي يثبته |
|---|---|---|---|---|
| 1 | إجمالي العملاء كان يُحسب ومعه الـcursor ⇒ ينقص مع كل صفحة | رقم مضلّل للمالك | فصل `filterWhere` عن `where` | `adm06-isolated-customers.test.tsx` |
| 2 | ملف العميل يعرض الطلبات والمبالغ لمن لا يملك `orders.view` | تسريب بيانات | منع قراءة الطلبات أصلًا + لوحة «محجوب» | نفس الملف |
| 3 | العرض `ACTIVE` المنتهي يظهر «شغّال» | تضليل تشغيلي | `promotionEffectiveStatus` + لوحة الحالات | `promotions.test.tsx`, `adm07-...test.tsx` |
| 4 | نموذج القواعد/اشترِ-احصل يبدأ فارغًا | المالك لا يرى القيم المحفوظة | `initial` من العرض المحفوظ | `adm07-isolated-promotion-detail.test.tsx` |
| 5 | اختيار منتجات العرض كان بلصق UUID | تجربة غير عملية | منتقي من الكتالوج | نفس الملف |
| 6 | لا معاينة سعر إطلاقًا | المالك لا يرى أثر العرض | نقطة معاينة عبر محرك الـcheckout | `admin-preview.test.ts` |
| 7 | `users/page.tsx` بنفس خلل الإجمالي | نفس الخلل خارج النطاق | إصلاح بنفس النمط | (تغطية ضمنية) |
| 8 | اختبارات a11y كانت تفشل تحت الحِمل بسبب مهلة 5s | false alarm | `testTimeout: 30000` | `a11y.test.tsx` |
| 9 | اختبار «استعادة التركيز» في لوحة الإدارة كان يثبت التركيز خارج `waitFor` | flake تحت الحِمل | التركيز داخل `waitFor` | `admin-shell.test.tsx` |
| 10 | حوار التأكيد (island محمّل ديناميكيًا) كان ينتظر 1s فقط | flake تحت الحِمل | مهلة `findByRole` = 10s | `adm05-isolated-fulfillment.test.tsx` |

> ملاحظة: البنود 8–10 ليست أخطاء في المنتج بل **اختبارات هشّة تحت الحِمل**؛ أُصلحت (مهلة/انتظار) دون تغيير أي assertion.

## 6. ما لم يُنفَّذ (بالقيد)

| الاختبار | السبب |
|---|---|
| E2E حي على `hyper_almoatasem` | أي E2E حي للطلبات/المخزون/العروض = كتابة على بيانات المتجر (ممنوعة) |
| تسجيل دخول داخل اللوحة | ينشئ Session (كتابة) |
| Screenshots من داخل اللوحة | لا جلسة ⇒ إعادة توجيه لصفحة الدخول |
| اختبارات الكتابة على قاعدة البيانات الأساسية | ممنوعة صراحةً في التكليف |

## 7. كيف يُشغَّل التحقق

```bash
# كل شيء (معزول)
npx vitest run

# مرحلة واحدة
npx vitest run src/lib/inventory/__tests__ src/app/admin/__tests__/inventory.test.tsx
npx vitest run src/app/admin/__tests__/orders.test.tsx src/components/admin/__tests__/adm05-isolated-fulfillment.test.tsx
npx vitest run src/app/admin/__tests__/adm06-isolated-customers.test.tsx
npx vitest run src/lib/promotions/__tests__/admin-preview.test.ts src/app/admin/__tests__/adm07-isolated-promotion-detail.test.tsx

# فحص الأنواع
npx tsc --noEmit -p tsconfig.json   # نظيف

# بناء Next.js (لا يكتب في قاعدة البيانات)
npx next build                      # Compiled successfully
```

## 8. النتيجة

**COMPLETE** (للاختبارات المعزولة) — 1815 اختبارًا ناجحًا، مع توثيق صريح لأن التحقق الحي (المتصفح/قاعدة البيانات) لم يكن ممكنًا ضمن حدود التفويض.
