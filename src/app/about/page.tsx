// FE-9 About (server): only facts the project proves about itself.
// Sources: store_settings (store.name), the approved brand promise and
// direction, the catalogue contract (categories / piece vs weight), the
// guest-checkout contract, and the owner-approved delivery-area fact (FP-11-5 D34).

import type { Metadata } from "next";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";

export const metadata: Metadata = {
  title: "من نحن — هايبر المعتصم",
  description: "ما يقدّمه هايبر المعتصم: كتالوج منتجات بالقطعة وبالوزن، وأسعار وإتاحة من الكتالوج، وطلب كضيف دون إنشاء حساب.",
};

export default function AboutPage() {
  return (
    <StoreShell>
    <InfoPage
      title="من نحن"
      lede="احتياجات بيتك بسهولة ووضوح، وثقة في كل خطوة."
    >
      <InfoSection title="ما نقدّمه">
        <InfoList
          items={[
            "كتالوج منتجات منظّم في أقسام، مع صفحة بحث ونتائج مرتّبة حسب الصلة.",
            "منتجات تُباع بالقطعة (عبوات كاملة) وأخرى بالوزن، والسعر معروض بالوحدة المناسبة لكل منتج.",
            "الأسعار والإتاحة تُقرأ من كتالوج المتجر، ويعرض المتجر سعر الوحدة وإجمالي السطر كما حسبهما الكتالوج.",
            "يمكن إتمام الطلب كضيف دون إنشاء حساب.",
          ]}
        />
      </InfoSection>

      <InfoSection title="التوصيل">
        <p>التوصيل داخل مطاي والمناطق القريبة.</p>
        <InfoNote>معلومة — لا يوجد تحقق لحظي من التغطية.</InfoNote>
        <p>
          تُحتسب رسوم التوصيل من إعدادات المتجر وتظهر في مراجعة الطلب قبل التأكيد، ويُنشأ الطلب بالعنوان
          الذي تدخله في صفحة الدفع.
        </p>
      </InfoSection>

      <InfoSection title="هويتنا">
        <p>عصري، نظيف وعملي — هايبر المعتصم.</p>
        <p>واجهة عربية من اليمين إلى اليسار، بخط Cairo، وبألوان المتجر المعتمدة.</p>
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
