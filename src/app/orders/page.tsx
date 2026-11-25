// FE-7 orders list (server): session owners only. Guests have no list (contract) —
// they reach orders via direct credential-held links, never a phone-based listing.

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { EmptyState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { listMyOrders } from "@/lib/frontend/order-reads";
import { formatMoney, formatOrderTimestamp, orderStatusLabel } from "@/lib/orders/display";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "طلباتي",
  robots: { index: false, follow: false },
};

export default async function OrdersPage() {
  const orders = await listMyOrders().catch(() => null);
  if (orders === null) {
    return (
      <StoreShell>
        <div className="mt-6">
          <PageTitle>طلباتي</PageTitle>
          <p className="mt-3 text-secondary">
            سجّل الدخول لعرض طلباتك. طلبات الضيف تُفتح من روابطها الخاصة فقط.
          </p>
          <p className="mt-2">
            <Link href="/login" className="inline-flex min-h-[44px] items-center font-semibold text-brand">
              تسجيل الدخول
            </Link>
          </p>
        </div>
      </StoreShell>
    );
  }
  return (
    <StoreShell>
      <div className="mt-6">
        <PageTitle>طلباتي</PageTitle>
      </div>
      {orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="لا توجد طلبات بعد" hint="ابدأ التسوق من الأقسام." />
        </div>
      ) : (
        <ul className="mt-4 grid gap-3.5 md:grid-cols-2">
          {orders.map((o) => (
            <li
              key={o.id}
              className="flex flex-col justify-between gap-3 rounded-card border border-line bg-white p-4 shadow-xs transition-colors hover:border-brand/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-bold text-ink">
                  <bdi className="whitespace-nowrap">{o.orderNumber}</bdi> · {orderStatusLabel(o.status)}
                </p>
                <span
                  className={`rounded-badge px-2.5 py-0.5 text-xs font-semibold ${
                    o.status === "CANCELLED"
                      ? "bg-[color:var(--error-bg)] text-error"
                      : o.status === "DELIVERED"
                        ? "bg-[color:var(--success-bg)] text-success-ink"
                        : "bg-purple-surface text-brand-deep"
                  }`}
                >
                  {orderStatusLabel(o.status)}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
                <div>
                  <p className="text-sm font-bold tabular-nums text-brand-deep">
                    <bdi>{formatMoney(o.total)}</bdi>
                  </p>
                  <p className="text-xs text-secondary">
                    <time dateTime={o.createdAt}>{formatOrderTimestamp(o.createdAt)}</time>
                  </p>
                </div>
                <Link
                  href={`/orders/${o.id}`}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-control border border-line px-4 text-sm font-semibold text-brand transition-colors hover:border-brand hover:bg-purple-surface"
                >
                  التفاصيل
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </StoreShell>
  );
}
