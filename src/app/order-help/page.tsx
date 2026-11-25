// FE-9 Order help (server): how a customer reaches their order, and what the
// guest-access rules really are.
// Sources: the order-detail page + the order reads (session ownership XOR a
// per-order guest credential), the guest-access domain (credential bound to ONE
// order, hash-only at rest, header-only transport, fixed 90-day lifetime, never
// in a URL, expired → 410, invalid → 401), the Phase-10 checkout recovery
// session (24h fixed, HttpOnly, read-only, bound to the one order it helped
// create) and the owner-approved spec FP-11-5 D36/D39 (rotation/revocation are
// staff-operated only; there is no guest self-service reissue and no
// order-number/phone lookup).
// The page states the implemented behaviour only; it never exposes a secret.
// Support is the ONE owner-approved channel: the approved contact number
// (src/lib/store/contact.ts). No email, no WhatsApp, no working hours are
// published — none of them has owner approval.

import type { Metadata } from "next";
import { canonicalMetadata } from "@/lib/seo/canonical";
import Link from "next/link";
import { InfoList, InfoNote, InfoPage, InfoSection } from "@/components/store/info-page";
import { StoreShell } from "@/components/store/store-shell";
import { StoreContactLink } from "@/components/store/contact-link";
import { ORDER_STATUSES } from "@/lib/orders/state-machine";
import { orderStatusLabel } from "@/lib/orders/display";

export const metadata: Metadata = {
  ...canonicalMetadata("/order-help"),
  title: "مساعدة الطلب",
  description: "كيف تفتح طلبك، ماذا يعني رقم الطلب، وماذا تفعل إذا فقدت الوصول إلى طلب ضيف.",
};

const STATUS_LABELS = ORDER_STATUSES.map((status) => `${orderStatusLabel(status)}.`);

export default function OrderHelpPage() {
  return (
    <StoreShell>
      <div className="mx-auto w-full max-w-3xl">
        <InfoPage
          title="مساعدة الطلب"
          lede="كيف تصل إلى طلبك، وما الذي يتيح الوصول إليه فعليًا."
        >
        <InfoSection title="إذا كان لديك حساب">
          <p>
            تظهر طلباتك في صفحة{" "}
            <Link
              href="/orders"
              className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]"
            >
              طلباتي
            </Link>
            ، وتفاصيل كل طلب في صفحته.
          </p>
        </InfoSection>

        <InfoSection title="إذا طلبت كضيف">
          <p>
            الوصول إلى طلب الضيف مرتبط بالمتصفح الذي أنشأت منه الطلب: افتح صفحة الطلب نفسها من
            ذلك المتصفح. لا يستطيع المتصفح أن يعرض طلبًا لم يُطلب من هذا المتصفح.
          </p>
          <InfoList
            items={[
              "رقم الطلب وحده لا يفتح تفاصيل الطلب.",
              "رقم الهاتف وحده لا يفتح تفاصيل الطلب.",
              "رمز الوصول لا يظهر داخل أي رابط أو عنوان صفحة، ولا يُعرض في قائمة الطلبات.",
              "صلاحية الوصول مرتبطة بطلب واحد فقط ولا تُنقل إلى جهاز آخر.",
              "تنتهي صلاحية رمز الوصول بعد 90 يومًا من إنشاء الطلب.",
            ]}
          />
          <p className="mt-3">
            إذا وصلت إلى صفحة التأكيد بعد إنشاء الطلب، فقد يحمل المتصفح جلسة استرداد مؤقتة
            أُنشئت قبل إتمام الطلب. هذه الجلسة تتيح <b>قراءة</b> الطلب الذي ساعدت في إنشائه فقط،
            وتنتهي بعد 24 ساعة، ولا تسمح بإلغاء الطلب أو قبول/رفض استبدال.
          </p>
        </InfoSection>

        <InfoSection title="إذا فقدت الوصول إلى طلب ضيف">
          <p>
            لا يوجد استرجاع ذاتي لإعادة إصدار رمز الوصول بعد انتهاء الجلسة المؤقتة. المتجر وحده
            يستطيع إصدار رمز جديد أو إلغاء الرمز القديم بعد التحقق من بيانات صاحب الطلب. راجع
            المتجر على رقم التواصل المعتمد مع رقم الطلب.
          </p>
          <InfoNote>
            رمز الوصول لا يُطلب منك عبر المحادثة ولا عبر البريد، ولا يُنشر في أي رابط.
          </InfoNote>
        </InfoSection>

        <InfoSection title="قناة التواصل">
          <p>
            رقم التواصل المعتمد مع المتجر هو{" "}
            <StoreContactLink className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]" />
            . تُستخدم القناة لطلب مراجعة حالة طلب، وطلب معالجة مشكلة في منتج، ومراجعة حالة
            إلغاء لم يعد متاحًا الإلغاء الذاتي فيها.
          </p>
          <p>
            يُفضَّل أن يكون رقم الطلب معك عند التواصل. توضيح التفاصيل في صفحة{" "}
            <Link
              href="/contact"
              className="font-semibold text-brand hover:text-[color:var(--ink-purple-deep)]"
            >
              تواصل معنا
            </Link>
            .
          </p>
          <InfoNote>
            التواصل عبر الرقم يعني طلب مراجعة فقط — القرار يحدّده المتجر بعد المراجعة. لا يعرض
            المتجر رابط واتساب ولا بريدًا إلكترونيًا ولا مواعيد عمل.
          </InfoNote>
        </InfoSection>

        <InfoSection title="حالات الطلب">
          <InfoList items={STATUS_LABELS} />
          <p>
            الحالة المعروضة في صفحة الطلب هي الحالة التي يقرؤها المتجر من الخادم، مع سجل الحالة
            المرتبط بها.
          </p>
        </InfoSection>

        <InfoSection title="ما لا يستطيعه المتجر">
          <InfoList
            items={[
              "لا يبحث المتجر عن طلب برقم هاتف أو باسم.",
              "لا يعرض طلبًا لمن لا يملك صلاحية الوصول إليه.",
              "لا يربط طلب الضيف بحساب يُنشأ لاحقًا.",
              "لا يَعِد بوقت وصول أو بقبول استبدال، ولا يَعِد بإلغاء بعد تسجيل كميات فعلية أو بعد أن يصبح الطلب جاهزًا.",
            ]}
          />
          <p>
            في الحالات التي يتوقف فيها الإلغاء الذاتي أو تظهر فيها مشكلة في منتج، تبدأ المراجعة عبر
            قناة التواصل المعتمدة، ويعود القرار في النهاية إلى المتجر.
          </p>
        </InfoSection>
      </InfoPage>
      </div>
    </StoreShell>
  );
}
