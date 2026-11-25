// FE-9 Contact (server): the one owner-approved store contact channel.
//
// Source: the owner's Phase-13 approval decision — 01000316676 is the approved
// contact number. It is published here (and read from the same module by the
// footer and the storefront messages) so no surface can drift.
//
// Approved scope only: a PHONE channel. The owner did NOT confirm that the
// number runs a WhatsApp account, so no WhatsApp link is published; and no
// email, postal address, working hours or response-time promise is published
// either. The two approved uses of the channel are the product-problem
// request and the review of a cancellation case that is no longer self-service.

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";
import { StoreContactLink } from "@/components/store/contact-link";

export const metadata: Metadata = {
  ...canonicalMetadata("/contact"),
  title: "تواصل معنا",
  description: "رقم التواصل المعتمد مع المتجر، ومتى تتواصل معه، وما لا يعرضه المتجر عبره.",
};

export default function ContactPage() {
  return (
    <StoreShell>
    <InfoPage
      title="تواصل معنا"
      lede="رقم واحد معتمد للتواصل مع المتجر."
    >
      <InfoSection title="رقم التواصل">
        <p>
          رقم التواصل المعتمد مع المتجر هو{" "}
          <StoreContactLink className="font-bold text-brand hover:text-[color:var(--ink-purple-deep)]" />
          .
        </p>
        <p>
          يمكنك الاتصال بالرقم مباشرة من هاتفك، ويفضَّل أن يكون رقم الطلب معك عند التواصل.
        </p>
      </InfoSection>

      <InfoSection title="متى تتواصل مع المتجر">
        <InfoList
          items={[
            "طلب معالجة مشكلة في منتج: استلمت منتجًا مختلفًا عن الذي طلبته، أو منتجًا تالفًا أو معيبًا، أو لاحظت اختلافًا بين المنتج والطلب. يراجع المتجر الحالة ويحدّد الإجراء المناسب.",
            "طلب مراجعة حالة إلغاء: بعد انتهاء نافذة الإلغاء الذاتي في صفحة الطلب، يمكنك التواصل مع المتجر لمراجعة الحالة.",
          ]}
        />
        <InfoNote>
          التواصل عبر الرقم يعني طلب مراجعة من المتجر — ولا يعني قبول الإجراء تلقائيًا. المتجر هو
          المرجع في القرار، ولا يُعرض أي موعد أو مدة للاستجابة.
        </InfoNote>
      </InfoSection>

      <InfoSection title="ما لا يعرضه المتجر">
        <InfoList
          items={[
            "لا يعرض المتجر رابط واتساب — لم يُعتمد أن الرقم مُفعَّل على واتساب.",
            "لا يعرض المتجر بريدًا إلكترونيًا أو عنوانًا بريديًا.",
            "لا يعرض المتجر مواعيد عمل أو ساعات تشغيل.",
            "لا يعرض المتجر مدة للاستجابة أو موعدًا لتنفيذ الطلب.",
          ]}
        />
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
