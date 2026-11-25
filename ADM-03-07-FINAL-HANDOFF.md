# ADM-03 → ADM-07 — FINAL HANDOFF
### Hyper Al-Moatasem Professional Admin Operational Management System
### التسليم النهائي — لوحة الإدارة: المنتجات، المخزون، الطلبات، العملاء، العروض

- **المشروع:** Hyper Al-Moatasem — هايبر المعتصم
- **المستودع:** `D:\Hyper_el-moatasem`
- **نطاق التنفيذ:** ADM-03، ADM-04، ADM-05، ADM-06، ADM-07 (بالترتيب المعتمد)
- **تاريخ التسليم:** 12 Nov 2026
- **الحكم النهائي:** **COMPLETE WITH LIMITATIONS**

---

## 1. الخلاصة في سطر واحد

الواجهات الخمس مكتملة ومتصلة بمصادر الحقيقة نفسها التي يقرأ منها المتجر والـcheckout، وكل الحالات الحساسة مغطاة باختبارات معزولة (1815 اختبارًا ناجحًا)، **ولم تُنفَّذ أي كتابة على بيانات المتجر**.

## 2. ما الذي يمكن للمالك أن يفعله الآن

| المجال | ما أصبح متاحًا | أين |
|---|---|---|
| المنتجات | رؤية نفس المنتجات التي يراها العميل، فهم الأقسام والترتيب، تعديل/إخفاء/إظهار/أرشفة/استعادة، فحص أهلية الحذف النهائي | `/admin/products`، `/admin/products/storefront`، `/admin/products/{id}` |
| المخزون | معرفة الرصيد، **التمييز بين الصفر المؤكد والرصيد المفقود والتوفر غير المؤكد**، سجل الحركات، التسوية الآمنة idempotent،_low-stock بدون حد أدنى لا يُصنَّف منخفضًا | `/admin/inventory`، `/admin/inventory/{variantId}` |
| الطلبات | كل الطلبات وحالاتها، تفاصيل واضحة، التاريخ والمراحل، تنفيذ الإجراءات المسموحة فقط، سجل حركة كامل | `/admin/orders`، `/admin/orders/{id}` |
| العملاء | الحسابات، الطلبات المرتبطة فعليًا، إجمالي الطلبات، تعطيل/إعادة تفعيل، تعديل البيانات | `/admin/customers`، `/admin/customers/{id}` |
| العروض | اختيار المنتجات **من كتالوج المتجر**، نسبة/مبلغ/سعر ثابت/اشترِ-احصل، **معاينة السعر القديم والجديد**، المدة، الأولوية، ومنع التعارض غير المسموح | `/admin/promotions`، `/admin/promotions/{id}` |

## 3. أهم ما أُنجز في هذه الجلسة (ISD-7)

| # | الإنجاز | الملف |
|---|---|---|
| 1 | **معاينة سعر حية عبر محرك الـcheckout نفسه** (لا حساب في المتصفح) + نقطة `GET /api/admin/promotions/{id}/preview` | `src/lib/promotions/admin-preview.ts`، `src/components/admin/promotion-preview.tsx` |
| 2 | **منتقي منتجات للعرض من كتالوج المتجر** (بدل لصق UUID) | `src/lib/admin/promotion-catalog.ts`، `src/components/admin/promotion-catalog-picker.tsx` |
| 3 | **الحالة الفعلية للعرض** (مجدول/شغّال/منتهي/موقوف/مسودة) + عدّادات + فلترة | `src/lib/admin/terminology.ts`، `src/lib/promotions/queries.ts`، `src/app/admin/promotions/page.tsx` |
| 4 | **نماذج القواعد واشترِ-احصل تبدأ بالقيم المحفوظة** | `src/components/admin/promotion-forms.tsx` |
| 5 | **إصلاح تسريب الطلبات في ملف العميل** لمن لا يملك `orders.view` (لا قراءة أصلًا) | `src/app/admin/customers/[id]/page.tsx` |
| 6 | **إصلاح إجمالي العملاء** (كان ينقص مع التصفح) | `src/app/admin/customers/page.tsx` |
| 7 | **ترقية قائمة العملاء إلى CRM** (بريد، حالة الحساب، إجمالي الطلبات، آخر طلب + المنطقة، فلتر تواريخ) | `src/app/admin/customers/page.tsx`، `src/lib/customers/admin-reads.ts` |
| 8 | **رفض الـid غير UUID في صفحة الطلب قبل أي قراءة** + إثبات أن اسم الموظف لا يظهر بلا `users.view` | `src/app/admin/__tests__/orders.test.tsx` |
| 9 | **إصلاح نفس خلل الإجمالي في صفحة المستخدمين** | `src/app/admin/users/page.tsx` |
| 10 | **إغلاق فجوة الـcensus**: نقطة المعاينة دخلت في تعداد مسارات الإدارة | `src/app/api/admin/promotions/[id]/preview/route.ts` |

## 4. الملفات المتأثرة

### جديد
```
src/lib/promotions/admin-preview.ts                     ← معاينة الأسعار (محرك الـcheckout)
src/lib/admin/promotion-catalog.ts                      ← كتالوج المتجر لاختيار منتجات العرض
src/lib/customers/admin-reads.ts                        ← ملخص طلبات العميل (استعلام واحد)
src/components/admin/promotion-preview.tsx              ← بطاقة المعاينة
src/components/admin/promotion-catalog-picker.tsx       ← منتقي المنتجات
src/components/admin/promotion-target-button.tsx        ← زر الإضافة للعرض
src/app/api/admin/promotions/[id]/preview/route.ts      ← نقطة المعاينة (GET)
src/app/admin/__tests__/adm06-isolated-customers.test.tsx
src/app/admin/__tests__/adm07-isolated-promotion-detail.test.tsx
src/lib/promotions/__tests__/admin-preview.test.ts
scripts/run-suite-evidence.mjs                          ← مشغّل توثيق الأدلة
ADM-03-PRODUCT-CATALOG-REPORT.md
ADM-04-INVENTORY-MANAGEMENT-REPORT.md
ADM-05-ORDER-MANAGEMENT-REPORT.md
ADM-06-CUSTOMER-MANAGEMENT-REPORT.md
ADM-07-PROMOTIONS-REPORT.md
ADM-03-07-INTEGRATION-REPORT.md
ADM-03-07-TEST-REPORT.md
ADM-03-07-FINAL-HANDOFF.md
```

### معدَّل
```
src/app/admin/promotions/page.tsx
src/app/admin/promotions/[id]/page.tsx
src/app/admin/customers/page.tsx
src/app/admin/customers/[id]/page.tsx
src/app/admin/users/page.tsx
src/app/admin/admin.css
src/components/admin/promotion-forms.tsx
src/components/admin/__tests__/adm05-isolated-fulfillment.test.tsx
src/app/admin/__tests__/promotions.test.tsx
src/app/admin/__tests__/orders.test.tsx
src/lib/admin/terminology.ts
src/lib/promotions/queries.ts
src/lib/promotions/checkout.ts        ← تصدير toEvalPromo فقط (بلا تغيير سلوك)
vitest.config.ts                       ← testTimeout 30s (إنذار مهلة تحت الحِمل)
```

## 5. كيف يتحقق المالك

```bash
cd D:\Hyper_el-moatasem

# 1) كل الاختبارات المعزولة (لا تكتب في قاعدة البيانات)
npx vitest run

# 2) فحص الأنواع
npx tsc --noEmit -p tsconfig.json

# 3) تشغيل اللوحة (يتطلب قاعدة البيانات وبيانات دخول — خارج حدود هذه المهمة)
npm run dev
```

**النتيجة الموثّقة:** `107 ملف اختبار / 1815 اختبارًا — كلها ناجحة`، و`tsc` نظيف، و`next build` ‏**Compiled successfully**.

## 6. فهرس الأدلة (Evidence)

في `D:\Hyper_Data_Review\Admin_Dashboard_Revamp\Run_20261112_ADM03_07\`:

| الملف | النتيجة |
|---|---|
| `ADM07-full-suite-04.*` | **1815 اختبارًا — exit 0 (التشغيل النهائي)** |
| `ADM07-types-03.*` | `tsc --noEmit` — exit 0 |
| `ADM07-build-01.*` | `next build` — **Compiled successfully** — exit 0 (والمسارات الجديدة داخل البناء: `/admin/promotions/[id]`, `/api/admin/promotions/[id]/preview`) |
| `ADM07-full-suite-03.*` | 1815 اختبارًا — exit 0 |
| `ADM07-full-suite-02.*` | 1814/1815 — كان فيه flake واحد في تركيز لوحة الإدارة (أُصلح، rerun = أخضر) |
| `ADM03-contract-01.*` | 356 اختبارًا — exit 0 |
| `ADM04-contract-01.*` | 269 اختبارًا — exit 0 |
| `ADM05-contract-01.*` | 163 اختبارًا — exit 0 |
| `ADM06-contract-01.*` | 6 اختبارات — exit 0 |
| `ADM07-contract-01.*` / `ADM07-contract-02.*` | 27 اختبارًا — exit 0 |
| `ADM07-types-01.*` / `ADM07-types-02.*` | `tsc --noEmit` — exit 0 |

> ملاحظة: الملفات الأقدم في نفس المجلد (مثل `ADM05-isolated-contract-01` بـ status 1) هي أدلة **قبل** إصلاحات هذه الجلسة، والبريد الأخضر أعلاه هو الحالة النهائية.

## 7. حدود الأمان التي احترمتها

| الممنوع | ما حدث فعلًا |
|---|---|
| كتابة على `hyper_almoatasem` | **لم يحدث** — صفر INSERT/UPDATE/DELETE |
| Migrations / Seeds / `prisma generate` | لم يحدث |
| Neon / قاعدة بديلة / Scratch DB | لم تُستخدم |
| إنشاء مستخدمين / طلبات / عروض / كوبونات حقيقية | لم يحدث |
| تغيير كلمة مرور المالك / صلاحيات المستخدمين | لم يحدث |
| تعديل بيئة التشغيل / Commit / Push / Deploy | لم يحدث |
| تجاوز المصادقة أو تعطيل RBAC | لم يحدث — كل كتابة تبقى server-gated |
| Schema change | **لا يوجد** — لم يُطلب أي تعديل على المخطط |

**ملاحظة عن التحقق الحي**: الدخول للوحة ينشئ Session في قاعدة البيانات (كتابة)، وهو ممنوع في هذا التكليف — لذلك لا يوجد Screenshot من داخل اللوحة في هذا التسليم، والتحقق تم عبر اختبارات تعزل الصفحة الحقيقية وتعرضها ببيانات مزيفة. هذا قيد موثّق في كل تقرير مرحلة.

## 8. القيود المعلنة (موحّدة)

1. **لا تحقق حي بالمتصفح** (السبب أعلاه).
2. **الحذف النهائي للمنتجات**: مُصمَّم ومُفحوص لكنه **غير مفعَّل تنفيذيًا** — القيد `PROMOTION_WRITER_LOCK_PROTOCOL_MISSING` (كتّاب العروض لا يقفلون الكيانات الكتالوجية).
3. **مسار تسوية المخزون القديم** `POST /api/admin/inventory/adjust` يبقى بلا Idempotency durable (الواجهة تستخدم `/adjustments` الآمن). لم يُعدَّل لأنه عقد BA مُجمَّد.
4. **الحذف/إخفاء بيانات العميل**: لا توجد سياسة Anonymization في المخطط — تحتاج Schema Proposal وموافقة قانونية من المالك.
5. **دفع الطلبات**: لا يوجد حقل «تم التحصيل» في المخطط — لم يُختلق.
6. **جدول الجرد المنفصل**: غير موجود — الموجود تسوية بسبب وفرق.
7. **BUY_X_GET_Y**: المعاينة تشرح القاعدة ولا تحاكي التكرار المتعدد (الحساب الحقيقي يبقى في الـcheckout).
8. **لا معاينة للكوبونات**، ولا «سجل استخدام» لكل عرض (الكوبونات فقط لها `usage_limit/used_count`).

## 9. موافقات مطلوبة من المالك (مجمّعة)

| # | القرار | المرحلة |
|---|---|---|
| 1 | تفعيل الحذف النهائي للمنتجات (يتطلب بروتوكول قفل لكتّاب العروض أولًا) | ADM-03 |
| 2 | سياسة الاحتفاظ ببيانات المنتجات المؤرشفة | ADM-03 |
| 3 | الحد الأدنى الافتراضي للمخزون + قرار «إخفاء المنتج عند نفاد الرصيد» | ADM-04 |
| 4 | جدول الجرد المنفصل (Schema Proposal) | ADM-04 |
| 5 | معالجة المسار القديم `/api/admin/inventory/adjust` (إبطال أو ترقية) | ADM-04 |
| 6 | حقل «تم التحصيل» + سياسة الإلغاء بعد بدء التجهيز + النطاق الزمني الافتراضي | ADM-05 |
| 7 | سياسة إزالة البيانات الشخصية للعميل (Anonymization) + مدة الاحتفاظ | ADM-06 |
| 8 | من يملك حق رؤية إجمالي طلبات العميل (`customers.view` أم `orders.view`) | ADM-06 |
| 9 | **قاعدة تراكم العروض الرسمية** (هل يتجمّع خصمان؟) + سقف الخصم الافتراضي + معاينة الكوبون | ADM-07 |

## 10. الخلاصة

| المرحلة | الحكم |
|---|---|
| ADM-03 المنتجات والكتالوج | COMPLETE WITH LIMITATIONS |
| ADM-04 المخزون | COMPLETE WITH LIMITATIONS |
| ADM-05 الطلبات | COMPLETE WITH LIMITATIONS |
| ADM-06 العملاء | COMPLETE WITH LIMITATIONS |
| ADM-07 العروض | COMPLETE WITH LIMITATIONS |
| **ADM-03 → ADM-07 ككل** | **COMPLETE WITH LIMITATIONS** |

> **ملاحظة على الحكم**: لم تُستخدم كلمة COMPLETE البحتة لأن (أ) التحقق الحي غير ممكن ضمن حدود التفويض، (ب) ثلاثة بنود تحتاج قرار المالك (الحذف النهائي، Anonymization، قاعدة تراكم العروض). البناء يمرّ، والاختبارات كلها خضراء، لكن **سلامة المخطط ≠ اتصال حقيقي بقاعدة البيانات**، و**تصميم عملية الحذف ≠ تنفيذ آمن للحذف** — والنظام يقول ذلك صراحةً بدل إخفائه.
