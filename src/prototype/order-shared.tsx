// INTERACTIVE PROTOTYPE — confirmation + order tracking + replacement decide (mock).
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { C, EmptyState, NoticeBar } from "@/prototype/ui";
import { useProto } from "@/prototype/store";

const STATUS_AR: Record<string, string> = {
  NEW: "تم استلام طلبك",
  CONFIRMED: "تم تأكيد الطلب",
  PREPARING: "جاري تجهيز طلبك",
  READY_FOR_DELIVERY: "طلبك جاهز",
  OUT_FOR_DELIVERY: "طلبك خرج للتوصيل",
  DELIVERED: "تم تسليم الطلب",
  CANCELLED: "تم إلغاء الطلب",
};

export function ConfirmationPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>تم استلام طلبك (محاكاة) — رقم الطلب: HM-000123</h1>
      <p style={{ color: "#5B556E" }}>هذه نتيجة تجريبية، وليست طلبًا حقيقيًا. لا يوجد تتبع لحظي (الحالة نصية فقط).</p>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Link
          href="/prototype/orders/o-demo-1"
          style={{ background: "#511D9C", color: "#fff", borderRadius: 8, padding: "12px 24px", minHeight: 44, display: "inline-block", fontWeight: 600 }}
        >
          تتبّع الطلب التجريبي
        </Link>
        <Link href="/prototype" style={{ alignSelf: "center", color: C.purple, fontWeight: 600 }}>
          العودة إلى المتجر
        </Link>
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { order, decideReplacement, resetOrder, notice, pending, runMock } = useProto();
  if (params.id !== order.id) {
    return <EmptyState title="الطلب غير موجود (محاكاة)" hint="تحقق من الرقم." />;
  }
  const rep = order.replacement;
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>
        الطلب {order.number} — {STATUS_AR[order.status] ?? order.status} (محاكاة)
      </h1>
      <h2 style={{ fontWeight: 800, marginTop: 12 }}>المنتجات (أسعار تجريبية)</h2>
      <ul style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {order.lines.map((l) => (
          <li key={l.name} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
            {l.name} — {l.qty} — <bdi>{l.price} ج.م</bdi>
          </li>
        ))}
      </ul>
      <h2 style={{ fontWeight: 800, marginTop: 12 }}>المطلوب مقابل الفعلي (محاكاة)</h2>
      <ul style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {order.requestedVsActual.map((r) => (
          <li key={r.name} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
            {r.name}: مطلوب {r.requested} — فعلي {r.actual ?? "لم يُجهّز بعد"}
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 8, fontWeight: 700 }}>الإجمالي التجريبي: {order.total} ج.م</p>
      <h2 style={{ fontWeight: 800, marginTop: 12 }}>البديل المقترح (محاكاة)</h2>
      {!rep ? (
        <p>لا يوجد بديل في هذا السيناريو — السطر ناقص ومعروض كنقص (محاكاة).</p>
      ) : rep.status === "PROPOSED" ? (
        <div style={{ border: `1px solid ${C.textOrange}`, borderRadius: 8, padding: 12 }}>
          <p>
            الأصلي: {rep.originalName} (غير متوفر) → البديل: {rep.substituteName} — {rep.substitutePrice} ج.م
          </p>
          <p style={{ color: "#5B556E" }}>بانتظار قرارك (محاكاة — بلا مواعيد نهائية).</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={pending}
              onClick={() => runMock(() => decideReplacement("CUSTOMER_APPROVED"))}
              style={{ background: C.success, color: "#fff", borderRadius: 8, padding: "10px 20px", minHeight: 44 }}
            >
              قبول البديل
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => runMock(() => decideReplacement("CUSTOMER_REJECTED"))}
              style={{ border: `1px solid ${C.error}`, color: C.error, borderRadius: 8, padding: "10px 20px", minHeight: 44 }}
            >
              رفض البديل
            </button>
          </div>
        </div>
      ) : (
        <p>
          قرارك مسجّل: {rep.status === "CUSTOMER_APPROVED" ? "مقبول (محاكاة)" : "مرفوض — السطر ناقص (محاكاة)"}{" "}
          <button type="button" onClick={resetOrder} style={{ color: C.purple, fontWeight: 700 }}>
            إعادة السيناريو
          </button>
        </p>
      )}
      <NoticeBar notice={notice} />
    </div>
  );
}
