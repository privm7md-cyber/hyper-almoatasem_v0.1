// FE-9 Cancellation policy (server): mirrors the rule the backend enforces,
// plus the owner-approved store-review pathway for the case that falls outside
// the self-service window.
//
// Sources: the order domain (lib/orders/writes.ts — cancellation allowed only
// from NEW|CONFIRMED|PREPARING with every line unpicked, 409 otherwise), the
// order-detail UI (the cancel action is offered for exactly those cases) and
// the checkout's own approved line that there is no payment step in this
// version (FP-11-5 D37).
//
// Owner-approved rule (Phase-13 decision B): the customer may request
// cancellation as long as the order has not reached the end of preparation
// («تم التجهيز» = «طلبك جاهز», READY_FOR_DELIVERY); from that point on the
// self-service cancellation is no longer automatically available and the
// customer may contact the store to review the case. That boundary is the
// same one the server enforces — the server stays the final authority.
// No refund promise, no fee, no time window, no monetary guarantee.

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import Link from "next/link";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";
import { StoreContactLink } from "@/components/store/contact-link";

export const metadata: Metadata = {
  ...canonicalMetadata("/cancellation"),
  title: "سياسة الإلغاء",
  description: "متى يمكن إلغاء الطلب من المتجر، وماذا تفعل بعد انتهاء تلك المدة.",
};

export default function CancellationPage() {
  return (
    <StoreShell>
    <InfoPage
      title="سياسة الإلغاء"
      lede="المدة التي يتيح فيها المتجر إلغاء الطلب بنفسك، وما بعدها."
    >
      <InfoSection title="متى يمكنك الإلغاء">
        <p>
          يظهر زر الإلغاء في صفحة تفاصيل الطلب ما دام الطلب في إحدى الحالات التالية:
        </p>
        <InfoList
          items={[
            "تم استلام طلبك.",
            "تم تأكيد الطلب.",
            "جاري تجهيز طلبك.",
          ]}
        />
        <p>
          بعد انتقال الطلب إلى «طلبك جاهز» أو «طلبك خرج للتوصيل» أو «تم تسليم الطلب» لا يمكن إلغاؤه
          من المتجر.
        </p>
        <p>
          وإذا بدأ تجهيز بعض عناصر الطلب وسُجلت لها كميات فعلية، يتوقف الإلغاء الذاتي حتى لو كانت
          الحالة «جاري تجهيز طلبك».
        </p>
      </InfoSection>

      <InfoSection title="إذا انتهت نافذة الإلغاء الذاتي">
        <p>
          بعد انتهاء التجهيز — أي عندما يصبح الطلب «طلبك جاهز» أو حالة تالية لها — لا يتاح الإلغاء
          الذاتي من صفحة الطلب. في هذه الحالة يمكنك التواصل مع المتجر ومراجعة حالة الطلب، ويحدّد
          المتجر بعد المراجعة ما إذا كان الإلغاء ممكنًا.
        </p>
        <p>
          وينطبق الأمر نفسه إذا سُجّلت كميات فعلية لبعض عناصر الطلب أثناء التجهيز، فالإلغاء الذاتي
          يتوقف عندها أيضًا.
        </p>
        <p>
          راجع المتجر على الرقم{" "}
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
          التواصل يعني طلب مراجعة فقط — لا يُعتبر الطلب ملغى إلا بعد تأكيد المتجر. المتجر هو المرجع
          في القرار، ولا تُعرض أي مدد أو رسوم أو شروط استرجاع.
        </InfoNote>
      </InfoSection>

      <InfoSection title="ماذا يحدث عند الإلغاء">
        <p>
          ينتقل الطلب إلى حالة «تم إلغاء الطلب»، وتُحرَّر الكميات المحجوزة لهذا الطلب. لا تُخصم أي
          مبالغ عبر الموقع في هذه النسخة.
        </p>
      </InfoSection>

      <InfoSection title="ما لا يعرضه المتجر">
        <InfoList
          items={[
            "لا يعرض المتجر مدة التحويل إلى «تم الإلغاء» ولا نافذة زمنية.",
            "لا يعرض المتجر سياسة استرجاع أموال أو استرداد لأن الاسترجاع غير منفذ في هذه النسخة.",
            "لا يعرض المتجر رسوم إلغاء ولا جدولًا زمنيًا للاسترداد.",
          ]}
        />
        <InfoNote>
          التفاصيل التي تحتاج قرارًا من إدارة المتجر (مثل مدد الإلغاء والاسترجاع) لم تُعتمد بعد، لذلك لم
          تُنشر. أمّا مسار مراجعة الحالة عبر رقم التواصل المعتمد فهو منشور أعلاه.
        </InfoNote>
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
