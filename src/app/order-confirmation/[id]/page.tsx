// FE-7 order confirmation (server): rendered ONLY from a readable order (dual policy).
// No success ever shown from the submit click alone — this page 404s/gates otherwise.
// The path carries the order id only (display identifier, never a credential).
// Headline follows the order's CURRENT server state: a cancelled order never
// keeps a "created successfully" success headline after a refresh.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { StoreShell } from "@/components/store/store-shell";
import { OrderRateLimitedNotice } from "@/components/store/order-rate-limited-notice";
import { getOrderDetail } from "@/lib/frontend/order-reads";
import { formatMoney, formatOrderTimestamp, orderStatusLabel } from "@/lib/orders/display";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تأكيد الطلب",
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderDetail(id).catch(() => null);
  if (!result || "error" in result) {
    if (result && (result.error === "UNAUTHENTICATED" || result.error === "GONE")) {
      return (
        <StoreShell>
          <div className="mt-6">
            <p className="font-bold">تعذّر عرض التأكيد</p>
            <p className="mt-2 text-sm text-secondary">
              {result.error === "GONE"
                ? "انتهت صلاحية الوصول إلى هذا الطلب — راجع خطوات الوصول في صفحة المساعدة."
                : "افتح رابط الطلب من المتصفح نفسه أو سجّل الدخول للمتابعة."}
            </p>
            <p className="mt-2">
              <Link href="/order-help" className="font-semibold text-brand">
                مساعدة الطلب
              </Link>
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
    if (result && result.error === "RATE_LIMITED") {
      // A throttled read is NOT a missing order: a 404 here would deny the
      // existence of an order the customer just placed.
      return <OrderRateLimitedNotice />;
    }
    notFound();
  }
  const { order } = result;
  const cancelled = order.status === "CANCELLED";
  return (
    <StoreShell>
      <div className="mx-auto mt-6 w-full max-w-2xl rounded-card border border-line bg-white p-6 shadow-xs">
        <div className="flex items-start gap-3 border-b border-line/70 pb-4">
          <span
            aria-hidden="true"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              cancelled ? "bg-[color:var(--error-bg)] text-error" : "bg-[color:var(--success-bg)] text-success-ink"
            }`}
          >
            {cancelled ? <XCircle size={22} /> : <CheckCircle2 size={22} />}
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-brand-deep">
              {cancelled ? "تم إلغاء طلبك" : "تم إنشاء طلبك بنجاح"}
            </h1>
            <p className="mt-1 text-xs text-secondary">
              <time dateTime={order.createdAt}>{formatOrderTimestamp(order.createdAt)}</time>
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-2.5 rounded-control border border-line/70 bg-purple-surface/35 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-secondary">رقم الطلب:</dt>
            <dd className="font-bold">
              <bdi className="whitespace-nowrap">{order.orderNumber}</bdi>
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-secondary">الحالة الحالية:</dt>
            <dd aria-live="polite" className="font-bold text-brand-deep">
              <bdi>{orderStatusLabel(order.status)}</bdi>
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-secondary">الإجمالي التقديري:</dt>
            <dd className="font-bold tabular-nums">
              <bdi>{formatMoney(order.totalEstimated)}</bdi>
            </dd>
          </div>
          {order.totalFinal !== null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
              <dt className="text-secondary">الإجمالي النهائي:</dt>
              <dd className="text-base font-extrabold tabular-nums text-brand-deep">
                <bdi>{formatMoney(order.totalFinal)}</bdi>
              </dd>
            </div>
          ) : null}
        </dl>

        {cancelled ? (
          <p className="mt-4 text-sm text-secondary">
            هذا الطلب ملغي بحسب حالة الخادم. لا يمكن تنفيذ إجراءات جديدة عليه.
          </p>
        ) : (
          <p className="mt-4 text-sm text-secondary">
            صفحة التأكيد تعرض الحالة الحالية للطلب من الخادم، وليست إشعار نجاح لحظيًا.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/orders/${order.id}`}
            className="vxp-primary-btn inline-flex min-h-[44px] items-center justify-center rounded-control bg-brand px-5 text-sm font-semibold text-white"
          >
            متابعة تفاصيل الطلب
          </Link>
          <Link
            href="/categories"
            className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong px-5 text-sm font-semibold text-ink hover:bg-purple-surface/50"
          >
            متابعة التسوق
          </Link>
        </div>
      </div>
    </StoreShell>
  );
}
