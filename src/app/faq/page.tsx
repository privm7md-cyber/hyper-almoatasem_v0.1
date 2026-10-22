// FE-9 FAQ (server): every answer is backed by the implemented contract.
// Each Q/A pairs with a source in the Phase 09 content-provenance record:
// the catalogue/search contract, the cart+order contract (lib/cart, lib/orders),
// the checkout implementation, the order-detail UI, and the owner-approved
// specs FP-11-5 (D34/D36/D37/D39). Questions whose answer would depend on an
// unapproved policy are NOT published here — they live in the decision register.

import type { Metadata } from "next";
import Link from "next/link";
import { InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";

export const metadata: Metadata = {
  title: "الأسئلة الشائعة — هايبر المعتصم",
  description: "إجابات عملية عن البحث والشراء بالقطعة وبالوزن، والتوافر، والطلب كضيف، ومتابعة الطلب، ورسوم التوصيل.",
};

const Q = ({ q, a }: { q: string; a: React.ReactNode }) => (
  <InfoSection title={q}>
    <div className="grid gap-2 leading-relaxed">{a}</div>
  </InfoSection>
);

export default function FaqPage() {
  return (
    <StoreShell>
    <InfoPage
      title="الأسئلة الشائعة"
      lede="إجابات عن ما يحدث فعليًا في المتجر ومن داخله."
    >
      <Q
        q="كيف أبحث عن منتج؟"
        a={
          <>
            <p>
              من صفحة الأقسام تتصفّح المنتجات حسب القسم، أو استخدم حقل البحث في أعلى الصفحة. البحث يعمل على
              اسم المنتج ويعرض المنتجات المطابقة.
            </p>
          </>
        }
      />

      <Q
        q="ما الفرق بين الشراء بالقطعة والشراء بالوزن؟"
        a={
          <>
            <p>
              بعض المنتجات تُباع بعبوة كاملة (بالقطعة) وأخرى تُباع بوزن تختاره. في حالة الوزن تختار الكمية
              من أوزان الشراء المتاحة: 125 جم أو 250 جم أو 500 جم أو 1 كجم أو 1.25 كجم، والسعر معروض
              لكل كيلوجرام، فيُحسب المبلغ على أساس الوزن الذي تختاره.
            </p>
          </>
        }
      />

      <Q
        q="هل الوزن الذي أختاره هو الوزن النهائي؟"
        a={
          <p>
            لا. الوزن الذي تختاره عند الطلب هو وزن تقديري، ويظهر في تفاصيل الطلب كـ«الكمية المطلوبة».
            الوزن الفعلي يحدده المتجر عند التجهيز، وعندها يظهر في تفاصيل الطلب كـ«الكمية الفعلية»،
            ويُعاد حساب سطر الطلب على أساسه.
          </p>
        }
      />

      <Q
        q="ماذا لو كان المنتج غير متوفر عند إتمام الطلب؟"
        a={
          <p>
            قد يبقى المنتج ظاهرًا في الكتالوج مع حالة توافر صريحة. وإذا لم يعد متوفرًا عند إنشاء الطلب
            يرفض المتجر إنشاء الطلب ويوضّح لك ذلك بدل قبول الطلب؛ بعد ذلك يمكنك مراجعة الطلب
            والإضافة من جديد.
          </p>
        }
      />

      <Q
        q="هل أحتاج إلى إنشاء حساب؟"
        a={
          <p>
            لا. يمكنك إتمام الطلب كضيف: تدخل بيانات التواصل والعنوان في صفحة الدفع، وتُستخدم لطلبك فقط
            ولا يُنشأ حساب. ويتيح المتجر أيضًا إنشاء حساب بالهاتف وكلمة المرور لمتابعة طلباتك.
          </p>
        }
      />

      <Q
        q="كيف أتابع طلبي؟"
        a={
          <>
            <p>
              إذا كان لديك حساب، تظهر طلباتك في صفحة «طلباتي». وإذا طلبت كضيف، يبقى الوصول إلى طلبك
              مرتبطًا بالمتصفح الذي أنشأت منه الطلب؛ افتح صفحة الطلب نفسها من ذلك المتصفح.
            </p>
            <p>
              رقم الطلب وحده لا يفتح تفاصيل الطلب، ولا يتيح ذلك لغيرك. إن فقدت الوصول إلى طلب الضيف فلا
              يوجد استرجاع ذاتي — يتم ذلك عبر المتجر.
            </p>
          </>
        }
      />

      <Q
        q="كم رسوم التوصيل؟"
        a={
          <p>
            تُقرأ رسوم التوصيل من إعدادات المتجر وتظهر في مراجعة الطلب قبل التأكيد، ويُحتسب ضمن الإجمالي
            المعروض هناك.
          </p>
        }
      />

      <Q
        q="هل يمكنني استخدام كود خصم؟"
        a={
          <p>
            يمكنك إدخال كود الكوبون في صفحة الدفع. إن كان الكود ساريًا ومستوفيًا للشروط فيظهر أثره في المراجعة،
            وإن لم يكن ساريًا يوضّح المتجر سبب عدم تطبيقه.
          </p>
        }
      />

      <Q
        q="كيف أُلغي طلبي؟"
        a={
          <p>
            يمكنك الإلغاء من صفحة تفاصيل الطلب ما دام الطلب في إحدى الحالات الأولى: «تم استلام طلبك» أو
            «تم تأكيد الطلب» أو «جاري تجهيز طلبك». بعد ذلك لا يمكن الإلغاء من المتجر.
          </p>
        }
      />

      <Q
        q="هل يمكن تغيير المنتج إذا نفد؟"
        a={
          <p>
            نعم. إذا اقترح المتجر بديلًا لمنتج لم يعد متاحًا، يظهر الاقتراح في تفاصيل الطلب مع سعر البديل
            والفرق عن السعر الأصلي، وتستطيع الموافقة عليه أو رفضه. كل اقتراح مسجّل على حدة.
          </p>
        }
      />

      <Q
        q="هل يتم الدفع داخل الموقع؟"
        a={
          <p>لا توجد خطوة دفع في هذه النسخة — يُنشأ الطلب مباشرة وفق العقد.</p>
        }
      />

      <Q
        q="ماذا يحدث إذا تغيّر السعر قبل أن أؤكد؟"
        a={
          <p>
            يرفض المتجر الطلب القديم ويوضّح أن الأسعار تغيّرت، فتعيد مراجعة الشروط وتؤكد الطلب بالأسعار
            الحالية.
          </p>
        }
      />

      <InfoSection title="صفحات ذات صلة">
        <ul className="grid gap-1">
          <li>
            <Link href="/delivery" className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]">
              سياسة التوصيل
            </Link>
          </li>
          <li>
            <Link href="/cancellation" className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]">
              سياسة الإلغاء
            </Link>
          </li>
          <li>
            <Link href="/replacement" className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]">
              سياسة الاستبدال
            </Link>
          </li>
          <li>
            <Link href="/order-help" className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]">
              مساعدة الطلب
            </Link>
          </li>
        </ul>
        <InfoNote>
          الصفحات تعرض ما ينفّذه المتجر فعليًا؛ التفاصيل التي تحتاج قرارًا من إدارة المتجر لم تُنشر بعد.
        </InfoNote>
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
