// FE-7 order detail (server, dual policy): session-owned OR guest-credential-held reads.
// Path id is display-only (never authorization). States: invalid-id / login-gated / expired /
// not-found / readable. No GPS/ETA/live claims — state + authoritative fields only.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreShell } from "@/components/store/store-shell";
import { CancelButton, DecideButtons } from "@/components/store/order-actions";
import { RefreshOrderButton } from "@/components/store/refresh-order-button";
import { getOrderDetail } from "@/lib/frontend/order-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الطلب",
  robots: { index: false, follow: false },
};

const STATUS_AR: Record<string, string> = {
  NEW: "تم استلام طلبك",
  CONFIRMED: "تم تأكيد الطلب",
  PREPARING: "جاري تجهيز طلبك",
  READY_FOR_DELIVERY: "طلبك جاهز",
  OUT_FOR_DELIVERY: "طلبك خرج للتوصيل",
  DELIVERED: "تم تسليم الطلب",
  CANCELLED: "تم إلغاء الطلب",
};

const REPLACEMENT_AR: Record<string, string> = {
  PROPOSED: "بانتظار قرارك",
  CUSTOMER_APPROVED: "مقبول",
  CUSTOMER_REJECTED: "مرفوض",
  AUTO_ACCEPTED: "مقبول تلقائيًا",
};

const CANCELLABLE = new Set(["NEW", "CONFIRMED", "PREPARING"]);

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderDetail(id).catch(() => null);
  if (!result || "error" in result) {
    if (result && result.error === "UNAUTHENTICATED") {
      return (
        <StoreShell>
          <div className="mt-6">
            <p className="font-bold">الوصول إلى الطلب يتطلب إثبات ملكية</p>
            <p className="mt-2 text-sm text-secondary">
              سجّل الدخول بحسابك، أو افتح رابط طلب الضيف من المتصفح نفسه.
            </p>
            <p className="mt-2">
              <Link href="/login" className="font-semibold text-brand">
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </StoreShell>
      );
    }
    if (result && result.error === "GONE") {
      return (
        <StoreShell>
          <div className="mt-6">
            <p className="font-bold">انتهت صلاحية الوصول إلى هذا الطلب</p>
            <p className="mt-2 text-sm text-secondary">
              راجع خطوات الوصول إلى الطلب في صفحة المساعدة.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/order-help" className="font-semibold text-brand">
                مساعدة الطلب
              </Link>
            </p>
          </div>
        </StoreShell>
      );
    }
    notFound();
  }
  const { order, replacements } = result;
  const canCancel = CANCELLABLE.has(order.status);
  return (
    <StoreShell>
      <div className="mt-6 grid gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">
            الطلب <bdi>{order.orderNumber}</bdi>
          </h1>
          <p className="mt-1 font-bold">{STATUS_AR[order.status] ?? order.status}</p>
          <div className="mt-2">
            <RefreshOrderButton />
          </div>
        </div>
        {order.history.length > 0 ? (
          <section aria-label="سجل الحالة">
            <h2 className="font-bold">سجل الحالة (من الخادم فقط)</h2>
            <ol className="mt-2 grid gap-1 text-sm">
              {order.history.map((h, i) => (
                <li key={`${h.createdAt}-${i}`} className="rounded-card border border-line bg-white p-2">
                  {h.oldStatus ? `${h.oldStatus} ← ` : ""}
                  <bdi className="font-bold">{h.newStatus}</bdi>
                  {h.actorType ? <span className="text-secondary"> · {h.actorType}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section aria-label="عناصر الطلب">
          <ul className="grid gap-2">
            {order.items.map((item) => (
              <li key={item.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <p className="font-bold">{item.productName} ({item.variantName})</p>
                <p className="text-secondary">
                  الكمية المطلوبة: <bdi>{item.requestedQuantity}</bdi>
                  {item.actualQuantity !== null ? (
                    <>
                      {" · "}الكمية الفعلية: <bdi>{item.actualQuantity}</bdi>
                    </>
                  ) : null}
                </p>
                <p>
                  الإجمالي التقديري: <bdi>{item.estimatedTotal} ج.م</bdi>
                  {item.finalTotal !== null ? (
                    <>
                      {" · "}النهائي: <bdi>{item.finalTotal} ج.م</bdi>
                    </>
                  ) : null}
                </p>
                <p className="text-secondary">الحالة: {item.itemStatus}</p>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="الإجماليات" className="rounded-card border border-line bg-white p-3 text-sm">
          <p>
            المجموع التقديري: <bdi>{order.totalEstimated} ج.م</bdi>
            {order.discountTotal !== "0.00" ? (
              <>
                {" · "}الخصم: <bdi>{order.discountTotal} ج.م</bdi>
              </>
            ) : null}
          </p>
          <p>
            التوصيل: <bdi>{order.deliveryFee} ج.م</bdi>
          </p>
          {order.totalFinal !== null ? (
            <p className="font-bold">
              الإجمالي النهائي: <bdi>{order.totalFinal} ج.م</bdi>
            </p>
          ) : null}
          <p className="text-secondary">
            التوصيل إلى: {[order.delivery.city, order.delivery.area, order.delivery.street].filter(Boolean).join("، ")}
          </p>
        </section>
        {replacements.length > 0 ? (
          <section aria-label="البدائل">
            <h2 className="font-bold">البدائل المقترحة ({replacements.length})</h2>
            <p className="text-xs text-secondary">كل اقتراح سجل مستقل — الأحدث قرارًا لا يمحو السابق.</p>
            <ul className="mt-2 grid gap-2">
              {replacements.map((r) => (
                <li key={r.id} className="rounded-card border border-line bg-white p-3 text-sm">
                  <p>
                    الأصلي: {r.original.productName} — البديل: {r.substitute.productName} (
                    <bdi>{r.replacementUnitPrice} ج.م</bdi>
                    {r.priceDifference !== "0.00" ? (
                      <>
                        {" · "}الفرق: <bdi>{r.priceDifference} ج.م</bdi>
                      </>
                    ) : null}
                    )
                  </p>
                  <p className="font-semibold">
                    {REPLACEMENT_AR[r.status] ?? r.status}
                    {r.status !== "PROPOSED" && r.decidedByType ? ` — القرار: ${r.decidedByType === "STAFF" ? "طاقم" : "عميل"}` : ""}
                  </p>
                  {r.status === "PROPOSED" ? (
                    <div className="mt-2">
                      <DecideButtons orderId={order.id} replacementId={r.id} decided={false} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <CancelButton orderId={order.id} canCancel={canCancel} />
        <p className="text-sm">
          <Link href="/order-help" className="font-semibold text-brand">
            مساعدة الطلب
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
