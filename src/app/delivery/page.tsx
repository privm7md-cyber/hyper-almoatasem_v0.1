// FE-9 Delivery policy (server): only what the system actually does.
// Sources: store_settings ('delivery.default_fee' = the fee the checkout reads),
// the checkout implementation (the fee line in the review step) and the
// owner-approved delivery-area fact + no-check disclaimer (FP-11-5 D34).
// No coverage list, no time window, no minimum order, no free-delivery claim.

import type { Metadata } from "next";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";

export const metadata: Metadata = {
  title: "سياسة التوصيل — هايبر المعتصم",
  description: "نطاق التوصيل، ورسوم التوصيل كما تُحتسب في المتجر، وما الذي يُنشأ به الطلب.",
};

export default function DeliveryPage() {
  return (
    <StoreShell>
    <InfoPage
      title="سياسة التوصيل"
      lede="ما ينفّذه المتجر فعليًا في التوصيل، دون وعود غير مطبَّقة."
    >
      <InfoSection title="نطاق التوصيل">
        <p>التوصيل داخل مطاي والمناطق القريبة.</p>
        <InfoNote>معلومة — لا يوجد تحقق لحظي من التغطية.</InfoNote>
        <p>
          لا يعرض المتجر قائمة قرى أو نطاقًا تفصيليًا، ولا يتحقق من تغطية العنوان لحظيًا قبل التأكيد؛
          المتجر يعرض النطاق أعلاه كما هو.
        </p>
      </InfoSection>

      <InfoSection title="رسوم التوصيل">
        <p>
          تُقرأ رسوم التوصيل من إعدادات المتجر وتظهر في مراجعة الطلب قبل التأكيد ضمن الإجمالي المعروض
          هناك. لا يحسب المتجر رسومًا من عنده ولا يعرض رسومًا عند تعذّر قراءتها.
        </p>
      </InfoSection>

      <InfoSection title="عنوان التوصيل">
        <p>
          يُنشأ الطلب بالعنوان الذي تدخله في صفحة الدفع: المدينة، والشارع، ورقم الهاتف، واسمك الأول.
          تُحفظ هذه البيانات في الطلب ولا تُرسل إلى جهة أخرى.
        </p>
      </InfoSection>

      <InfoSection title="ما لا يعرضه المتجر حاليًا">
        <InfoList
          items={[
            "لا توجد نوافذ توصيل أو مواعيد وصول معلنة.",
            "لا يوجد حد أدنى لقيمة الطلب.",
            "لا يعرض المتجر رسومًا لا تأتي من إعداداته.",
          ]}
        />
        <InfoNote>
          لم تُعتمد بعد سياسة مواعيد أو استثناءات أو شروط خاصة برسوم التوصيل، لذلك لم تُنشر هنا.
        </InfoNote>
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
