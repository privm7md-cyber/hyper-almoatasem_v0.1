// FE-7 orders list (server): session owners only. Guests have no list (contract) —
// they reach orders via direct credential-held links, never a phone-based listing.

import type { Metadata } from "next";
import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";
import { EmptyState } from "@/components/ui/states";
import { PageTitle } from "@/components/ui/container";
import { listMyOrders } from "@/lib/frontend/order-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "طلباتي",
  robots: { index: false, follow: false },
};

const STATUS_AR: Record<string, string> = {
  NEW: "تم الاستلام",
  CONFIRMED: "مؤكد",
  PREPARING: "قيد التجهيز",
  READY_FOR_DELIVERY: "جاهز",
  OUT_FOR_DELIVERY: "خرج للتوصيل",
  DELIVERED: "تم التوصيل",
  CANCELLED: "ملغي",
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
            <Link href="/login" className="font-semibold text-brand">
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
        <div className="mt-3">
          <EmptyState title="لا توجد طلبات بعد" hint="ابدأ التسوق من الأقسام." />
        </div>
      ) : (
        <ul className="mt-3 grid gap-3">
          {orders.map((o) => (
            <li key={o.id} className="rounded-card border border-line bg-white p-3">
              <p className="font-bold">
                <bdi>{o.orderNumber}</bdi> · {STATUS_AR[o.status] ?? o.status}
              </p>
              <p className="text-sm text-secondary">
                <bdi>{o.total} ج.م</bdi>
              </p>
              <Link href={`/orders/${o.id}`} className="text-sm font-semibold text-brand">
                التفاصيل
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StoreShell>
  );
}
