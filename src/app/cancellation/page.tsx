// FE-9 Cancellation policy (server): mirrors the rule the backend enforces.
// Sources: the order domain (lib/orders/writes.ts — cancellation allowed only
// from the early states; 409 otherwise), the order-detail UI (the cancel
// action is offered for NEW / CONFIRMED / PREPARING) and the checkout's own
// approved line that there is no payment step in this version (FP-11-5 D37).
// No refund promise, no time window, no monetary guarantee.

import type { Metadata } from "next";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";

export const metadata: Metadata = {
  title: "سياسة الإلغاء",
  description: "متى يمكن إلغاء الطلب من المتجر، وما الذي يحدث بعد انتهاء تلك المدة.",
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
          ]}
        />
        <InfoNote>
          التفاصيل التي تحتاج قرارًا من إدارة المتجر (مثل مدد الإلغاء والاسترجاع) لم تُعتمد بعد، لذلك لم
          تُنشر.
        </InfoNote>
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
