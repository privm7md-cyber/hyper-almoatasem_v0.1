// FE-9 Order help (server): how a customer reaches their order, and what the
// guest-access rules really are.
// Sources: the order-detail page + the order reads (session ownership XOR a
// per-order guest credential), the guest-access domain (credential bound to ONE
// order, hash-only at rest, header-only transport, fixed 90-day lifetime, never
// in a URL, expired → 410, invalid → 401) and the owner-approved spec
// FP-11-5 D36/D39 (rotation/revocation are staff-operated only; there is no
// guest self-service recovery and no order-number/phone lookup).
// The page states the implemented behaviour only; it never exposes a secret.

import type { Metadata } from "next";
import Link from "next/link";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";

export const metadata: Metadata = {
  title: "مساعدة الطلب",
  description: "كيف تفتح طلبك، ماذا يعني رقم الطلب، وماذا تفعل إذا فقدت الوصول إلى طلب ضيف.",
};

const STATUS_LABELS = [
  "تم استلام طلبك.",
  "تم تأكيد الطلب.",
  "جاري تجهيز طلبك.",
  "طلبك جاهز.",
  "طلبك خرج للتوصيل.",
  "تم تسليم الطلب.",
  "تم إلغاء الطلب.",
];

export default function OrderHelpPage() {
  return (
    <StoreShell>
    <InfoPage
      title="مساعدة الطلب"
      lede="كيف تصل إلى طلبك، وما الذي يتيح الوصول إليه فعليًا."
    >
      <InfoSection title="إذا كان لديك حساب">
        <p>
          تظهر طلباتك في صفحة{" "}
          <Link href="/orders" className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]">
            طلباتي
          </Link>
          ، وتفاصيل كل طلب في صفحته.
        </p>
      </InfoSection>

      <InfoSection title="إذا طلبت كضيف">
        <p>
          الوصول إلى طلب الضيف مرتبط بالمتصفح الذي أنشأت منه الطلب: افتح صفحة الطلب نفسها من ذلك
          المتصفح. لا يستطيع المتصفح أن يعرض طلبًا لم يُطلب من هذا المتصفح.
        </p>
        <InfoList
          items={[
            "رقم الطلب وحده لا يفتح تفاصيل الطلب.",
            "رقم الهاتف وحده لا يفتح تفاصيل الطلب.",
            "رمز الوصول لا يظهر داخل أي رابط أو عنوان صفحة، ولا يُعرض في قائمة الطلبات.",
            "صلاحية الوصول مرتبطة بطلب واحد فقط ولا تُنقل إلى جهاز آخر.",
            "تنتهي صلاحية الوصول بعد 90 يومًا من إنشاء الطلب.",
          ]}
        />
      </InfoSection>

      <InfoSection title="إذا فقدت الوصول إلى طلب ضيف">
        <p>
          لا يوجد استرجاع ذاتي لرمز الوصول: المتجر وحده يستطيع إصدار رمز جديد أو إلغاء الرمز القديم بعد
          التحقق من بيانات صاحب الطلب. راجع المتجر مع رقم الطلب.
        </p>
        <InfoNote>
          رمز الوصول لا يُطلب منك عبر المحادثة ولا عبر البريد، ولا يُنشر في أي رابط.
        </InfoNote>
      </InfoSection>

      <InfoSection title="حالات الطلب">
        <InfoList items={STATUS_LABELS} />
        <p>
          الحالة المعروضة في صفحة الطلب هي الحالة التي يقرؤها المتجر من الخادم، مع سجل الحالة المرتبط
          بها.
        </p>
      </InfoSection>

      <InfoSection title="ما لا يستطيعه المتجر">
        <InfoList
          items={[
            "لا يبحث المتجر عن طلب برقم هاتف أو باسم.",
            "لا يعرض طلبًا لمن لا يملك صلاحية الوصول إليه.",
            "لا يربط طلب الضيف بحساب يُنشأ لاحقًا.",
          ]}
        />
      </InfoSection>
    </InfoPage>
    </StoreShell>
  );
}
