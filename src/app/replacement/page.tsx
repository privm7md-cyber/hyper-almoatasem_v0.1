// FE-9 Replacement policy (server): the replacement contract, plus the
// owner-approved product-problem request path.
//
// Sources: the replacement domain (lib/replacements/* — a proposal is
// PROPOSED and becomes CUSTOMER_APPROVED / CUSTOMER_REJECTED / AUTO_ACCEPTED),
// the order-detail UI (each proposal shows the substitute, its unit price and the
// price difference, and offers approve/reject) and the fulfilment spec
// (FP-11-8-3). No automatic-acceptance promise for the customer, no new
// fees, prices or limits.
//
// Owner-approved rule (Phase-13 decision C): the customer may request problem
// handling — including replacement where possible — when a different product is
// delivered than the one ordered, when the product is damaged or defective, or
// when a product/order mismatch is noticed. The store reviews the case and
// determines the appropriate action. There is NO self-service request feature
// and no online request API for this path (none exists in the backend), so the
// approved route is the approved contact channel; and no substitute
// availability, replacement date or refund is promised.

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import Link from "next/link";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";
import { StoreContactLink } from "@/components/store/contact-link";

export const metadata: Metadata = {
  ...canonicalMetadata("/replacement"),
  title: "سياسة الاستبدال",
  description: "ماذا يحدث إذا لم يعد منتج متاحًا، وكيف تتعامل مع اقتراح البديل، وماذا تفعل عند استلام منتج مختلف أو تالف.",
};

export default function ReplacementPage() {
  return (
    <StoreShell>
    <InfoPage
      title="سياسة الاستبدال"
      lede="ما يفعله المتجر عندما لا يتوفر منتج، وما يمكنك فعله، وكيف تطلب معالجة مشكلة في منتج استلمته."
    >
      <InfoSection title="عندما لا يتوفر منتج">
        <p>
          إذا تعذّر توفير أحد منتجات طلبك، قد يقترح المتجر بديلًا له. يظهر الاقتراح في صفحة تفاصيل
          الطلب مع اسم البديل وكميته وسعره والفرق عن السعر الأصلي.
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

      <InfoSection title="إذا استلمت منتجًا مختلفًا أو تالفًا">
        <p>
          يمكنك طلب معالجة مشكلة في منتج في هذه الحالات:
        </p>
        <InfoList
          items={[
            "استلمت منتجًا مختلفًا عن المنتج الذي طلبته.",
            "استلمت منتجًا تالفًا أو معيبًا.",
            "لاحظت اختلافًا بين المنتج المستلم وما طلبته.",
          ]}
        />
        <p>
          يراجع المتجر الحالة ويحدّد الإجراء المناسب — بما في ذلك الاستبدال إن كان ممكنًا. التواصل
          يتم على الرقم{" "}
          <StoreContactLink className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]" />{" "}
          أو من صفحة{" "}
          <Link
            href="/contact"
            className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]"
          >
            تواصل معنا
          </Link>
          ، ويُفضَّل أن يكون رقم الطلب معك.
        </p>
        <InfoNote>
          هذا المسار طلب مراجعة من المتجر عبر قناة التواصل المعتمدة — لا يوجد في الموقع زر لطلب
          المعالجة ولا صفحة تُرسل منها الطلب. القرار يحدّده المتجر بعد المراجعة.
        </InfoNote>
      </InfoSection>

      <InfoSection title="ما لا يعرضه المتجر">
        <InfoList
          items={[
            "لا يعرض المتجر رسومًا أو فروقًا أسعار إضافية خارج فرق السعر المعروض في الاقتراح.",
            "لا يعرض المتجر مدة محددة لاتخاذ القرار على البديل.",
            "لا يعرض المتجر موعدًا للاستبدال ولا يَعِد بوجود بديل متاح.",
            "لا يعرض المتجر استردادًا ولا مبلغًا مُستردًّا مقابل مشكلة في منتج.",
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
