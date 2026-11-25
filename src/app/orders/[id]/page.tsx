// FE-7 order detail (server, dual policy): session-owned OR guest-credential-held reads.
// Path id is display-only (never authorization). States: invalid-id / login-gated / expired /
// not-found / readable. No GPS/ETA/live claims — state + authoritative fields only.
//
// Eligibility is derived with the same rules the backend enforces
// (lib/orders/display.ts mirrors cancelOrder/decideReplacement): a button is
// never offered for an action the server would answer 409 for.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, XCircle } from "lucide-react";
import { StoreShell } from "@/components/store/store-shell";

const TIMELINE_STEPS = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

function OrderStatusTimeline({ status }: { status: OrderShape["status"] }) {
  if (status === "CANCELLED") {
    return (
      <div
        role="status"
        className="flex items-center gap-2.5 rounded-card border border-error/40 bg-[color:var(--error-bg)] px-4 py-3 text-sm font-semibold text-error"
      >
        <XCircle size={18} aria-hidden="true" className="shrink-0" />
        <span>هذا الطلب ملغي بحسب حالة الخادم: {orderStatusLabel(status)}.</span>
      </div>
    );
  }
  const currentIdx = (TIMELINE_STEPS as readonly string[]).indexOf(status);
  return (
    <section aria-label="مراحل الطلب" className="rounded-card border border-line bg-white p-4 shadow-xs">
      <h2 className="text-sm font-bold text-brand-deep">مسار تنفيذ الطلب</h2>
      <ol className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
        {TIMELINE_STEPS.map((step, idx) => {
          const passed = currentIdx > idx;
          const active = currentIdx === idx;
          return (
            <li
              key={step}
              aria-current={active ? "step" : undefined}
              className={`flex flex-col items-start gap-1.5 rounded-control border p-2.5 text-xs ${
                active
                  ? "border-brand bg-purple-surface/65 font-bold text-brand-deep"
                  : passed
                    ? "border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-900"
                    : "border-line bg-white text-secondary"
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  passed
                    ? "bg-emerald-600 text-white"
                    : active
                      ? "bg-brand text-white"
                      : "bg-purple-surface text-secondary"
                }`}
              >
                {passed ? <Check size={12} /> : idx + 1}
              </span>
              <span>{orderStatusLabel(step)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
import { CancelButton, DecideButtons } from "@/components/store/order-actions";
import { ReplacementConversation } from "@/components/store/replacement-conversation";
import { OrderRateLimitedNotice } from "@/components/store/order-rate-limited-notice";
import { RefreshOrderButton } from "@/components/store/refresh-order-button";
import { getOrderDetail } from "@/lib/frontend/order-reads";
import {
  actorTypeLabel,
  canCustomerCancel,
  canDecideReplacement,
  formatMoney,
  formatOrderTimestamp,
  formatQuantity,
  itemStatusLabel,
  orderStatusLabel,
  quantitiesEqual,
  replacementStatusLabel,
  unitLabel,
} from "@/lib/orders/display";
import type { OrderItemShape, OrderShape } from "@/lib/orders/serialize";
import type { ReplacementShape } from "@/lib/replacements/serialize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الطلب",
  robots: { index: false, follow: false },
};

function itemQuantityLabels(item: OrderItemShape): { requested: string; actual: string } {
  if (item.productType === "WEIGHT") {
    return { requested: "الوزن المطلوب", actual: "الوزن الفعلي بعد التجهيز" };
  }
  return { requested: "الكمية المطلوبة", actual: "الكمية الفعلية بعد التجهيز" };
}

function ItemLine({ item }: { item: OrderItemShape }) {
  const labels = itemQuantityLabels(item);
  const actual =
    item.actualQuantity === null ? null : formatQuantity(item.actualQuantity, item.productType);
  // Decimal equality, never a float comparison: the backend stores
  // NUMERIC(12,3) and "0.250" vs "0.25" must read as the SAME quantity.
  const differs = !quantitiesEqual(item.actualQuantity, item.requestedQuantity);
  return (
    <li className="rounded-card border border-line bg-white p-3 text-sm">
      <p className="font-bold">
        {item.productName} ({item.variantName})
      </p>
      <p className="text-secondary">
        {labels.requested}: <bdi>{formatQuantity(item.requestedQuantity, item.productType)}</bdi>{" "}
        {unitLabel(item.unit)}
      </p>
      {actual !== null ? (
        <p className="text-secondary">
          {labels.actual}: <bdi>{actual}</bdi> {unitLabel(item.unit)}
        </p>
      ) : null}
      <p className="text-secondary">
        سعر الوحدة: <bdi>{formatMoney(item.unitPrice)}</bdi> / {unitLabel(item.unit)}
      </p>
      <p>
        المبلغ التقديري للسطر: <bdi>{formatMoney(item.estimatedTotal)}</bdi>
        {item.finalTotal !== null ? (
          <>
            {" · "}المبلغ النهائي للسطر: <bdi className="font-bold">{formatMoney(item.finalTotal)}</bdi>
          </>
        ) : null}
      </p>
      {differs ? (
        <p className="text-xs text-secondary">
          القيمة الفعلية تختلف عن المطلوبة.
          {item.finalTotal === null
            ? " لم يُعتمد المبلغ النهائي للسطر بعد."
            : " المبلغ النهائي للسطر محسوب من الكمية الفعلية."}
        </p>
      ) : null}
      <p className="text-secondary">حالة السطر: {itemStatusLabel(item.itemStatus)}</p>
    </li>
  );
}

function ReplacementCard({
  order,
  replacement,
}: {
  order: OrderShape;
  replacement: ReplacementShape;
}) {
  const originalItem = order.items.find((item) => item.id === replacement.original.orderItemId);
  const canDecide = canDecideReplacement({
    orderStatus: order.status,
    replacementStatus: replacement.status,
    originalItemStatus: replacement.original.itemStatus,
    originalActualQuantity: originalItem?.actualQuantity,
  });
  return (
    <li className="rounded-card border border-line bg-white p-3 text-sm">
      <p>
        الأصلي: {replacement.original.productName} — البديل: {replacement.substitute.productName}
      </p>
      <p className="text-secondary">
        الكمية البديلة:{" "}
        <bdi>
          {formatQuantity(replacement.replacementQuantity, replacement.substitute.productType)}
        </bdi>{" "}
        {unitLabel(replacement.substitute.unit)}
      </p>
      <p>
        سعر وحدة البديل: <bdi>{formatMoney(replacement.replacementUnitPrice)}</bdi> /{" "}
        {unitLabel(replacement.substitute.unit)}
        {replacement.priceDifference !== "0.00" ? (
          <>
            {" · "}فرق السعر الإجمالي: <bdi>{formatMoney(replacement.priceDifference)}</bdi>
          </>
        ) : null}
      </p>
      <p className="font-semibold">
        {replacementStatusLabel(replacement.status)}
        {replacement.status !== "PROPOSED" && replacement.decidedByType
          ? ` — القرار: ${actorTypeLabel(replacement.decidedByType)}`
          : ""}
      </p>
      {replacement.status === "PROPOSED" ? (
        canDecide ? (
          <div className="mt-2">
            <DecideButtons orderId={order.id} replacementId={replacement.id} decided={false} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-secondary">
            لا يمكن اتخاذ قرار على هذا الاقتراح في حالة الطلب الحالية.
          </p>
        )
      ) : null}
    </li>
  );
}

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
    if (result && result.error === "RATE_LIMITED") {
      // A throttled read is NOT a missing order: rendering it as a 404 would
      // tell the customer their own order does not exist.
      return <OrderRateLimitedNotice />;
    }
    notFound();
  }
  const { order, replacements } = result;
  const canCancel = canCustomerCancel(order);
  const hasPickedLines = order.items.some((item) => item.actualQuantity !== null);
  const cancelBlockedByPicking =
    !canCancel &&
    hasPickedLines &&
    (order.status === "NEW" || order.status === "CONFIRMED" || order.status === "PREPARING");
  return (
    <StoreShell>
      <div className="mx-auto mt-6 grid w-full max-w-3xl gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-white p-5 shadow-xs">
          <div>
            <h1 className="text-xl font-extrabold text-brand-deep sm:text-2xl">
              الطلب <bdi className="whitespace-nowrap">{order.orderNumber}</bdi>
            </h1>
            <p className="mt-1.5 inline-flex items-center rounded-badge bg-purple-surface px-3 py-1 text-sm font-bold text-brand-deep" aria-live="polite">
              {orderStatusLabel(order.status)}
            </p>
          </div>
          <div>
            <RefreshOrderButton />
          </div>
        </div>
        <OrderStatusTimeline status={order.status} />
        {order.history.length > 0 ? (
          <section aria-label="سجل الحالة" className="rounded-card border border-line bg-white p-5 shadow-xs">
            <h2 className="font-bold text-brand-deep">سجل الحالة (من الخادم فقط)</h2>
            <ol className="mt-3 grid gap-2 text-sm">
              {order.history.map((h, i) => (
                <li
                  key={`${h.createdAt}-${i}`}
                  className="rounded-control border border-line/80 bg-purple-surface/25 p-3"
                >
                  <p className="font-bold">{orderStatusLabel(h.newStatus)}</p>
                  <p className="mt-0.5 text-xs text-secondary">
                    {h.oldStatus ? `من: ${orderStatusLabel(h.oldStatus)} · ` : "بداية الطلب · "}
                    {actorTypeLabel(h.actorType)} ·{" "}
                    <time dateTime={h.createdAt}>{formatOrderTimestamp(h.createdAt)}</time>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section aria-label="عناصر الطلب" className="rounded-card border border-line bg-white p-5 shadow-xs">
          <ul className="grid gap-2.5">
            {order.items.map((item) => (
              <ItemLine key={item.id} item={item} />
            ))}
          </ul>
        </section>
        <section
          aria-label="الإجماليات"
          className="grid gap-1.5 rounded-card border border-line bg-white p-5 text-sm shadow-xs"
        >
          <p>
            المجموع التقديري للسلع: <bdi>{formatMoney(order.subtotalEstimated)}</bdi>
          </p>
          {order.discountTotal !== "0.00" ? (
            <p>
              الخصم: <bdi>{formatMoney(order.discountTotal)}</bdi>
            </p>
          ) : null}
          <p>
            التوصيل: <bdi>{formatMoney(order.deliveryFee)}</bdi>
          </p>
          <p>
            الإجمالي التقديري (شامل التوصيل): <bdi>{formatMoney(order.totalEstimated)}</bdi>
          </p>
          {order.subtotalFinal !== null ? (
            <p>
              المجموع النهائي للسلع: <bdi>{formatMoney(order.subtotalFinal)}</bdi>
            </p>
          ) : null}
          {order.totalFinal !== null ? (
            <p className="font-bold">
              الإجمالي النهائي (شامل التوصيل): <bdi>{formatMoney(order.totalFinal)}</bdi>
            </p>
          ) : null}
          <p className="text-secondary">
            التوصيل إلى:{" "}
            {[order.delivery.city, order.delivery.area, order.delivery.street]
              .filter(Boolean)
              .join("، ")}
          </p>
        </section>
        {replacements.length > 0 ? (
          <>
            <ReplacementConversation orderId={order.id} replacements={replacements} />
            <section aria-label="البدائل">
            <h2 className="font-bold">البدائل المقترحة ({replacements.length})</h2>
            <p className="text-xs text-secondary">
              كل اقتراح سجل مستقل — الأحدث قرارًا لا يمحو السابق.
            </p>
            <ul className="mt-2 grid gap-2">
              {replacements.map((r) => (
                <ReplacementCard key={r.id} order={order} replacement={r} />
              ))}
            </ul>
            </section>
          </>
        ) : null}
        <CancelButton orderId={order.id} canCancel={canCancel} />
        {cancelBlockedByPicking ? (
          <p className="text-sm text-secondary">
            بدأ تجهيز بعض عناصر الطلب، لذلك لم يعد الإلغاء الذاتي متاحًا من هنا.
          </p>
        ) : null}
        <p className="text-sm">
          <Link href="/order-help" className="font-semibold text-brand">
            مساعدة الطلب
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
