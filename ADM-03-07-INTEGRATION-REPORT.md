# ADM-03 → ADM-07 — INTEGRATION REPORT
### تقرير التكامل بين مراحل المنتجات والمخزون والطلبات والعملاء والعروض

- **المشروع:** Hyper Al-Moatasem — هايبر المعتصم
- **النطاق:** ADM-03، ADM-04، ADM-05، ADM-06، ADM-07
- **تاريخ التنفيذ:** 12 Nov 2026
- **قاعدة البيانات:** صفر عمليات كتابة على `hyper_almoatasem` أو أي قاعدة بديلة.

---

## 1. القاعدة الحاكمة

كل وحدة في اللوحة تقرأ من **نفس المصدر** الذي يقرأ منه المتجر أو الـcheckout:

| الحقيقة | المصدر | لمن يستعمله |
|---|---|---|
| المنتجات المعروضة وترتيبها | `src/lib/catalog/queries.ts` + `src/lib/frontend/storefront-reads.ts` | المتجر + الكتالوج الإداري (ADM-03) |
| الأقسام | `categories` (نفس الاستعلام) | المتجر + ADM-03 + منتقي العروض (ADM-07) |
| صور المنتجات | `product_images` + `listPrimaryImagesForProducts` | المتجر + ADM-03 + ADM-07 |
| الرصيد | `inventory.available_quantity` (GENERATED) | ADM-04 + المعاينة (ADM-07) |
| أسعار المنتجات | `product_variants.price` | المتجر + ADM-03 + ADM-07 |
| خصومات الطلب | `src/lib/promotions/engine.ts` (محرك واحد) | الـcheckout + المعاينة (ADM-07) |
| طلبات العميل | `orders.customer_id` (الارتباط الفعلي فقط) | ADM-05 + ADM-06 |
| حالات الطلب | `src/lib/orders/state-machine.ts` (مصدر واحد) | المتجر + ADM-05 |

**لا توجد نسخة ثانية من أي قاعدة** داخل لوحة الإدارة.

## 2. التكامل Module → Module

### 2.1 المنتجات → المخزون

| القاعدة | التنفيذ | التحقق |
|---|---|---|
| المخزون مرتبط بالـVariant لا بالمنتج | `inventory.productVariantId` (1:1) | `src/lib/inventory/overview.ts` لا يعرض رصيد منتج مجمّع |
| كل Variant لها وحدة صحيحة | `inventoryUnit(productType, sizeUnit)` | `src/lib/inventory/overview.ts` |
| إخفاء المنتج لا يمسح المخزون | `transitionProduct` يغيّر `isActive`/`deletedAt` فقط | `src/lib/catalog/lifecycle.ts` |
| أرشفة المنتج لا تمحو حركاته | الحركات تُقرأ بـ`productVariantId` ولا تُمسح بالأرشفة | نفس الملف |
| تغيير السعر لا يغيّر الرصيد | مسار السعر منفصل تمامًا (`variants/[id]/price`) | `src/app/api/admin/catalog/variants/[id]/price/route.ts` |
| عدم وجود رصيد ≠ صفر | `variantBalanceState` يعيد `missing` | `src/lib/inventory/overview.ts` + اختبار |

### 2.2 المنتجات → الطلبات

| القاعدة | التنفيذ |
|---|---|
| الطلب التاريخي لا يعتمد على السعر الحالي | `order_items` يحمل snapshot: `product_name_snapshot`, `unit_price`, `estimated_total`, `final_total`, `product_code_snapshot`, `unit_snapshot`, `product_type_snapshot` |
| تعديل اسم/صورة المنتج لا يفسد Snapshot الطلب | Snapshot مستقل نصيًا؛ تعديل الكتالوج لا يمس `order_items` |
| إخفاء المنتج لا يحذف عناصر طلباته | الإخفاء `isActive=false` فقط |
| لا حذف منتج مرتبط بتاريخ تجاري | `getProductDeletionEligibility` يفحص `orderItems` + `replacements` + `promotion_targets`، والحذف النهائي غير مفعَّل تنفيذيًا |

### 2.3 المخزون → الطلبات

| القاعدة | التنفيذ |
|---|---|
| لا خصم مخزون مرتين | الحجز/الخصم داخل Transaction إنشاء الطلب نفسه (`src/lib/orders/writes.ts`)، وكل طلب يحمل `idempotency_key` |
| لا خصم وزن بوحدة خاطئة | الكميات بالآلاف من الوحدة (thousandths) + `sizeUnit`؛ `saleStepGrams` يفرض مضاعفات الخطوة |
| عدم تجاوز حدود التوفر | القفل + مقارنة المتاح داخل الـTransaction |
| آلية الحجز محفوظة | `reservedQuantity` عمود مستقل، والمتاح عمود GENERATED |
| إلغاء الطلب يعالج الحجز بالقاعدة الحالية | حركة `CANCELLED_ORDER` تكمل الحجز داخل نفس القاعدة |

### 2.4 العملاء → الطلبات

| القاعدة | التنفيذ |
|---|---|
| سجل العميل يعرض الطلبات المرتبطة فعليًا | `orders.customer_id` (FK) + `customerOrderSummaries` |
| Guest Orders لا تُربط بأثر رجعي | `orders.customer_id` nullable ولا يُملأ لاحقًا |
| تعطيل الحساب لا يمحو الطلبات | `customers.is_active` مستقل عن `orders` |
| حذف بيانات العميل لا يفسد السجلات | الحذف المنطقي `customers.deleted_at` + `orders.customer_id` `onDelete: Restrict` |
| **تسريب مصلح في هذه الجلسة** | كان ملف العميل يعرض الطلبات لمن لا يملك `orders.view` → أُصلح، والاختبار يثبت عدم قراءة الطلبات أصلًا |

### 2.5 العروض → المنتجات

| القاعدة | التنفيذ |
|---|---|
| اختيار المنتجات من مصدر الكتالوج الصحيح | `loadPromotionCatalog` يقرأ نفس الكتالوج النشط |
| السعر الأصلي ثابت | `product_variants.price` لا يتغير بوجود عرض |
| حساب الخصم صحيح | محرك الـcheckout (integers piastres، لا float) |
| المتغير المستهدف محدد | `promotion_targets` بـ`target_type` + `target_id` |
| لا تطبيق على منتج غير مؤهل | `matchLine` في المحرك + `inSubtree` للتصنيفات |

### 2.6 العروض → الطلبات

| القاعدة | التنفيذ |
|---|---|
| الطلب يستخدم قواعد التسعير الرسمية | `applyPromotions(tx, ...)` داخل Transaction الإنشاء |
| Snapshot السعر لا يتغير عند تعديل العرض لاحقًا | `persistPromoRows` تجمّد `applied_percent/amount/fixed_price` في `order_discounts` |
| لا تراكم غير مسموح | بوابة التراكم في المحرك + `is_stackable` |
| ترتيب الأولوية واحد في كل الأماكن | نفس المحرك يُستخدم في المعاينة (ADM-07) وفي الـcheckout |

## 3. نقاط تم التحقق منها في هذه الجلسة عبر الاختبارات

| النقطة | الاختبار |
|---|---|
| الكتالوج الإداري = المتجر | `storefront-parity.test.tsx`, `admin-product-list.test.ts` |
| الرصيد المفقود ≠ صفر | `inventory.test.tsx`, `adm04-isolated-adjust-stock.test.ts` |
| التسوية لا تتكرر + Concurrency | `adm04-isolated-adjustments-route.test.ts`, `adm04-isolated-adjust-stock.test.ts` |
| الانتقالات الصالحة/غير الصالحة + منع التكرار | `orders.test.tsx`, `adm05-isolated-orders.test.tsx`, `adm05-isolated-fulfillment.test.tsx` |
| حدود التاريخ بتوقيت القاهرة + DST | `orders.test.tsx` (اختباران parametrized) |
| طلبات الضيف محمية | `adm05-isolated-orders.test.tsx` + `src/lib/orders/__tests__/` |
| عزل الضيف عن حسابات العملاء | `adm06-isolated-customers.test.tsx` |
| Idempotency + Authorization لكل الكتابات | `src/lib/api/__tests__/admin-preview-census.test.ts` (82 اختبارًا — census لكل مسارات الإدارة) |
| معاينة الأسعار = محرك الـcheckout | `admin-preview.test.ts` |
| العرض المنتهي لا يُعرض «شغّال» | `promotions.test.tsx`, `adm07-isolated-promotion-detail.test.tsx` |

## 4. جداول التوصيات (Cross-cutting)

| الموضوع | القرار الحالي | مصدره |
|---|---|---|
|timezone العمل | Africa/Cairo (الأيام محسوبة على مدار الساعة المحلية) | `src/lib/admin/date-range.ts` |
| نافذة التاريخ | نصف مفتوح `>= start AND < endExclusive` | نفس الملف |
| العملة | EGP | `formatMoney` |
| صيغة التاريخ | إنجليزية | `formatDate` |
| اللغة | عربية RTL | نظام التصميم الإداري |
| التقريب | piastres (أعداد صحيحة) للكميات، 3 منازل للكميات في المخزون | المحرك + المخطط |

## 5. risks المتبقية (Known Risks)

1. **Screenshots**: لا يوجد — الدخول للوحة ينشئ Session في قاعدة البيانات (كتابة)، وهو ممنوع في هذا التكليف؛ التحقق كله عبر اختبارات معزولة تُصيّر الصفحات الحقيقية.
2. **لا تحقق حي** من داخل اللوحة في هذه المهمة (كتابة Session ممنوعة) — التحقق كله معزول.
2. **مسار تسوية المخزون القديم** `/api/admin/inventory/adjust` غير idempotent (موثّق في تقرير ADM-04).
3. **الحذف النهائي للمنتجات** غير مفعَّل عمدًا حتى لو كانت العلاقات آمنة (قيد `PROMOTION_WRITER_LOCK_PROTOCOL_MISSING`).
4. **الأنENAME/إزالة البيانات الشخصية للعميل** غير موجودة في الـSchema.
5. **تراكم العروض**: القاعدة الحالية (أول غير قابل للتراكم يوقف ما بعده) — تحتاج قرار المالك إن اختلف المطلوب.

## 6. النتيجة

**COMPLETE WITH LIMITATIONS** — كل الواجهات الخمس متصلة بمصادر الحقيقة نفسها، وكل الحالات الحساسة (المفقود/الصفر، المنتهي/الشغّال، الطلب المخفي، الخصم غير المخوّل) مغطاة باختبارات معزولة، ولم تُنفَّذ أي كتابة على بيانات المتجر.
