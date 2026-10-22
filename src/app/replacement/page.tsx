// FE-9 Replacement policy (server): mirrors the replacement contract.
// Sources: the replacement domain (lib/replacements/* — a proposal is
// PROPOSED and becomes CUSTOMER_APPROVED / CUSTOMER_REJECTED / AUTO_ACCEPTED),
// the order-detail UI (each proposal shows the substitute, its unit price and the
// price difference, and offers approve/reject) and the fulfilment spec
// (FP-11.8-3). No automatic-acceptance promise for the customer, no new
// fees, prices or limits.

import type { Metadata } from "next";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";

export const metadata: Metadata = {
  title: "سياسة الاستبدال — هايبر المعتصم",
  description: "ماذا يحدث إذا لم يعد منتج متاحًا، وكيف تتعامل مع اقتراح البديل.",
};

export default function ReplacementPage() {
  return (
    <StoreShell>
    <InfoPage
      title="سياسة الاستبدال"
      lede="ما يفعله المتجر عندما لا يتوفر منتج، وما يمكنك فعله."
    >
      <InfoSection title="عندما لا يتوفر منتج">
        <p>
          إذا تعذّر توفير أحد منتجات طلبك، قد يقترح المتجر بديلًا له. يظهر الاقتراح في صفحة تفاصيل
          الطلب مع اسم البديل وسعره والفرق عن السعر الأصلي.
        </p>
      </InfoSection>

      <InfoSection title="ما يمكنك فعله">
        <InfoList
          items={[
            "الموافقة على البديل المقترح.",
            "رفض البديل المقترح.",
          ]}
        />
        <p>
          كل اقتراح مسجّل على حدة، وقرارك اللاحق لا يمحو القرار السابق.
        </p>
      </InfoSection>

      <InfoSection title="قرار المتجر">
        <p>
          في بعض الحالات قد يعتمد المتجر البديل تلقائيًا وفق قواعده الداخلية. في هذه الحالة يظهر ذلك
          في تفاصيل الطلب بحالة واضحة.
        </p>
      </InfoSection>

      <InfoSection title="ما لا يعرضه المتجر">
        <InfoList
          items={[
            "لا يعرض المتجر رسومًا أو فروقًا أسعار إضافية خارج فرق السعر المعروض في الاقتراح.",
            "لا يعرض المتجر مدة محددة لاتخاذ القرار على البديل.",
          ]}
        />
        <InfoNote>
          التفاصيل التي تحتاج قرارًا من إدارة المتجر (مثل نافذة قبول البديل وقواعده) لم تُعتمد بعد،
          لذلك لم تُنشر.
        </InfoNote>
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
