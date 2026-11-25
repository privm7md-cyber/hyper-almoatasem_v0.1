# ADM-03 — PRODUCT MANAGEMENT & STOREFRONT CATALOG
### تقرير إدارة المنتجات ومطابقة الكتالوج الإداري مع واجهة المتجر

- **المشروع:** Hyper Al-Moatasem — هايبر المعتصم
- **المرحلة:** ADM-03
- **الحالة النهائية:** COMPLETE WITH LIMITATIONS
- **تاريخ التنفيذ:** 12 Nov 2026
- **قاعدة البيانات:** لم يُنفَّذ أي write على `hyper_almoatasem` (ولا على أي قاعدة بديلة). كل التحقق المعزول تم على mocks/fixtures.

---

## 1. ما كان موجودًا قبل التنفيذ

| المجال | الحالة قبل ADM-03 | الملاحظات |
|---|---|---|
| استعلام المتجر للكتالوج | موجود | `src/lib/catalog/queries.ts` + `src/lib/frontend/storefront-reads.ts` |
| استعلام المنتجات الإداري | موجود | `listProducts` / `countProducts` |
| صفحة المنتجات الإدارية | موجودة لكن بواجهة قديمة | لا Exist أرقام معروضة/مخفية/مؤرشفة ولا شريط أدوات إداري |
| دورة حياة المنتج | غير موجودة | لا يوجد تمييز بين `isActive` و`deletedAt` ولا مسار أرشفة/استعادة |
| الحذف النهائي | غير موجود | لا يوجد فحص للعلاقات قبل الحذف |
| صور المنتج | سجل `product_images` موجود في المخطط | لا توجد واجهة إدارة (ترتيب/أساسية/حذف) |
| شجرة الأقسام والعلامات | موجودة | `listCategories` / `listBrands` |
| رمز الباركود | `product_codes` موجود | الواجهة تعرضه للقراءة فقط |

## 2. ما تم تنفيذه في هذه المرحلة

### 2.1 واجهة الكتالوج الإداري (Product Management)

- صفحة `src/app/admin/products/page.tsx` أُعيد بناؤها حول نموذج **Case** واحد:
  `معروض / مخفي / مؤرشف`، وفلترة على: القسم، العلامة، الحالة، نوع البيع (PIECE/WEIGHT)، التوفر، السعر، والبحث بالاسم/الباركود/المعرّف.
- **الشريط العلوي** يعرض: الإجمالي، المعروض، المخفي، المؤرشف، وزر «منتج جديد».
- **شبكة المنتجات** ببطاقات إدارية (`admin-product-card.tsx`) تحمل: الصورة، الاسم، القسم، العلامة، السعر بوحدته الصحيحة، حالة الظهور، حالة التوفر، والعدد المميّز للمتغيرات.
- **أدوات الإدارة على كل بطاقة**: تعديل، إخفاء/إظهار، أرشفة، تفاصيل، المخزون، سجل التغييرات — وتظهر بحسب حالة المنتج وصلاحية الحساب، لا كلها في نفس الوقت.
- **السعر بوحدته**: لا يُعرض سعر الكيلوجرام كسعر للقطعة؛ وحدة البيع تُقرأ من نوع المنتج الفعلي (`سعر الكيلوجرام` أو `بالقطعة`).

### 2.2 دورة حياة المنتج (Lifecycle)

- فصل واضح بين الحقول:
  - `isActive` = معروض/مخفي (يظهر أو لا يظهر في المتجر).
  - `deletedAt` = مؤرشف (خارج القائمة النشطة، قابل للاستعادة).
  - `deletedAt IS NOT NULL` = لا يمكن تعديله إلا بالاستعادة (منع في `transitionProduct`).
- مسارات API جديدة تحت `src/app/api/admin/catalog/products/[id]/`:
  - `archive/route.ts` — أرشفة مع سبب إلزامي وAudit داخل نفس الـTransaction.
  - `restore/route.ts` — استعادة.
  - `deletion-eligibility/route.ts` — فحص إمكانية الحذف النهائي (قراءة فقط).
- `src/lib/catalog/lifecycle.ts` هو المصدر الوحيد للحالة (Authorization + Validation + Reason + Audit + Idempotency عبر `alreadyApplied`).

### 2.3 الأرشيف والحذف النهائي (Hard Delete Safety)

- أرشيف المنتجات مدمج في نفس الصفحة عبر `?state=archived` (بحث + فلترة + تاريخ الأرشفة + المستخدم + السبب من `audit_logs`).
- فحص `getProductDeletionEligibility` يفحص العلاقات: المخزون، الحركات، تاريخ الأسعار، عناصر السلة، عناصر الطلبات، البدائل، شكل البيع المجاني، استهدافات العروض (استعلام خام على `promotion_targets` لأن الاستهدافات متعددة الأشكال ولا يوجد FK)، سجل التدقيق.
- **قرار تصميمي موثّق**: نتيجة الفحص تُرجع دائمًا `executable: false` مع القيد `PROMOTION_WRITER_LOCK_PROTOCOL_MISSING` — لأن كتّاب العروض لا يقفلون الكيانات الكتالوجية، فسلامة orphan لا يمكن إثباتها بعدد صفحات صفري. لذلك: **الحذف النهائي مُصمَّم ومُفحوص لكنه غير مفعَّل تنفيذيًا**، والواجهة تشرح السبب بدل أن تعدو بحذف يفسد السجل التاريخي.

### 2.4 صفحة تفاصيل المنتج

- `src/app/admin/products/[id]/page.tsx`: بيانات المنتج، معرض الصور، أشكال البيع، الأسعار، الأكواد (باركود/كود داخلي)، حالة الظهور، ملخص التوفر، أدوات الأرشفة والاستعادة، وسجل التغييرات.
- `src/components/admin/product-image-manager.tsx`: معرض مرتّب، اختيار الصورة الأساسية، حذف صورة بتأكيد، تحقق النوع والحجم، رفض غير الصور.
- `src/components/admin/product-lifecycle-controls.tsx`: أدوات الإظهار/الإخفاء/الأرشفة/الاستعادة مع نتيجة العملية الحقيقية من الـServer (لا رسالة نجاح قبل تأكيد الـAPI).

### 2.5 مطابقة الكتالوج الإداري مع المتجر (Parity) — أهم بند

- `src/lib/admin/storefront-catalog.ts`: **read-only adapter** يقرأ بنفس استعلامات المتجر (`listProducts` / `searchProducts` + `enrichCards` + `getHomeCategorySections`) وليس بقائمة الإدارة.
- الصفحة `src/app/admin/products/storefront/page.tsx` تعرض: نفس الأقسام بنفس الترتيب، نفس ترتيب المنتجات، نفس الصور، نفس الأسماء، نفس الأسعار، نفس الفلاتر، ونفس الـPagination (cursor).
- **اختبار parity**: `src/app/admin/__tests__/storefront-parity.test.tsx` + `src/lib/catalog/__tests__/admin-product-list.test.ts` — يقارن معرّفات المنتجات والأقسام وأشكال البيع وقواعد الفلترة والترتيب بين المصدرين.

## 3. الملفات المتأثرة

| الملف | الدور |
|---|---|
| `src/app/admin/products/page.tsx` | الكتالوج الإداري + الفلترة + الأرشيف |
| `src/app/admin/products/[id]/page.tsx` | تفاصيل المنتج + دورة الحياة |
| `src/app/admin/products/new/page.tsx` | إنشاء منتج |
| `src/app/admin/products/storefront/page.tsx` | كتالوج المتجر (Parity) |
| `src/lib/admin/storefront-catalog.ts` | محوّل القراءة الموحّد مع المتجر |
| `src/lib/catalog/lifecycle.ts` | منطق الحالة + فحص إمكانية الحذف |
| `src/lib/catalog/queries.ts` | استعلامات الكتالوج (مصدر الحقيقة) |
| `src/app/api/admin/catalog/products/[id]/archive|restore|deletion-eligibility/route.ts` | مسارات دورة الحياة |
| `src/components/admin/admin-product-card.tsx`, `product-filters.tsx`, `product-image-manager.tsx`, `product-lifecycle-controls.tsx` | الواجهات |
| `src/app/admin/admin.css` | ستايل البطاقات والفلاتر |

**Models المستخدمة:** `Product`, `ProductVariant`, `ProductImage`, `ProductCode`, `Category`, `Brand`, `Inventory`, `InventoryMovement`, `ProductPriceHistory`, `PromotionTarget` (استهدافات متعددة الأشكال).

**API المستخدمة:** `GET/POST/PATCH/DELETE /api/admin/catalog/products*`, `.../variants`, `.../variants/[id]/price`, `.../images`, `.../archive`, `.../restore`, `.../deletion-eligibility`.

## 4. الاختبارات

| الاختبار | النتيجة |
|---|---|
| `src/app/admin/__tests__/catalog.test.tsx` | PASS |
| `src/app/admin/__tests__/storefront-parity.test.tsx` | PASS |
| `src/app/admin/__tests__/product-lifecycle-detail.test.tsx` | PASS |
| `src/app/admin/__tests__/product-stock.test.tsx` | PASS |
| `src/components/admin/__tests__/product-lifecycle-media.test.tsx` | PASS |
| `src/lib/catalog/__tests__/lifecycle*.test.ts` (4 ملفات) | PASS |
| `src/lib/catalog/__tests__/admin-product-list.test.ts`, `name-integrity.test.ts`, `serialize-cost-exclusion.test.ts`, `admin-cost-boundaries.test.ts` | PASS |
| `src/app/admin/__tests__/a11y.test.tsx` (قائمة المنتجات) | PASS |

إجمالي مجموعة الاختبارات المعزولة في هذه الجلسة: **1815 اختبارًا في 107 ملفات — كلها ناجحة** (بدون أي كتابة على قاعدة البيانات).

## 5. Performance

- الكتالوج الإداري: ترقيم keyset على مستوى الخادم (20/صفحة) — لا يُحمَّل الكتالوج كاملًا في المتصفح.
- فرنش الكتالوج الإداري: `PAGE_LIMIT = 12` صفحة، مع `countProducts` بدون cursor (الإجمالي يصف المجموعة كلها لا بقية الصفحات).
- `listPrimaryImagesForProducts` يحمّل الصور الأساسية لكل المنتجات في **استعلام واحد** (معالج N+1).
- بحث المتجر: `searchProducts` بفلترة على مستوى SQL مع GIN/FTS.

## 6. Security

- كل كتابة على الكتالوج تمر عبر `adminOrDeny` / `requirePermission` على الخادم (لا اعتماد على إخفاء الزر في الواجهة).
- `lifecycle.ts` يعمل داخل Transaction مع قفل الصف وAudit في نفس الوحدة، وسبب إلزامي للأرشفة.
- الأسعار والتكلفة: `serialize-cost-exclusion` يمنع تسريب `costPrice` لكل دور لا يملك `prices.view`.
- الحذف النهائي: غير مفعَّل تنفيذيًا + الفحص يعرض أسباب المنع.
- حساب المعاينة/الـpreview: `admin-read-only-preview` يمنع الكتابة في بيئة المعاينة.

## 7. القيود (Limitations)

1. **Screenshots**: لا يوجد — الدخول للوحة ينشئ Session في قاعدة البيانات (كتابة)، وهو ممنوع في هذا التكليف. التحقق تم عبر اختبارات معزولة تُصيّر الصفحة الحقيقية ببيانات مزيفة.
2. **لا تحقق حي من داخل اللوحة**، والسبب مذكور أعلاه.
2. **الحذف النهائي غير مفعَّل** (قرار تصميمي موثّق) — يتطلب موافقة صريحة + بروتوكول قفل لكتّاب العروض قبل أي تنفيذ.
3. **صور المنتجات**: التخزين يبقى كما هو (روابط خارجية/سجل بيانات فقط) — لا يوجد رفع ملفات جديد في هذه المرحلة.
4. **لا يمكن قياس TTFB/LCP من المتصفح** بنفس القيد أعلاه.

## 8. موافقات مطلوبة من المالك (Pending Owner Approvals)

1. تفعيل الحذف النهائي للمنتجات غير المرتبطة بسجلات محمية — يتطلب اعتماد `PROMOTION_WRITER_LOCK_PROTOCOL` أولًا.
2. سياسة الاحتفاظ ببيانات المنتجات المؤرشفة (مدة الحفظ قبل الأرشفة الدائمة).
3. (اختياري) رفع صور المنتجات إلى Storage بدل الروابط الخارجية.
