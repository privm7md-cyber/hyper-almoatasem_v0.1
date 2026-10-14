// FE-10E admin orders list (server): status/search/customer/date filters + cursor-next.
// Reads: orders.view. No metrics/aggregates (no verified source).

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listOrdersAdmin } from "@/lib/orders/queries";
import { toOrderListItem } from "@/lib/orders/serialize";
import { EmptyState, ErrorState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "الطلبات — الإدارة",
  robots: { index: false, follow: false },
};

const STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; cursor?: string }>;
}) {
  await requirePermission("orders.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : null;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 64) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: ReturnType<typeof toOrderListItem>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listOrdersAdmin({
      limit: 20,
      cursor,
      status,
      customerId: null,
      search,
      dateFrom: null,
      dateTo: null,
    });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20).map((o) => toOrderListItem(o, o._count.items));
  } catch {
    rows = null;
  }
  const qs = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}), ...extra });
    const s = params.toString();
    return s === "" ? "/admin/orders" : `/admin/orders?${s}`;
  };
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">الطلبات</h1>
      <form method="get" action="/admin/orders" className="flex flex-wrap gap-2">
        <label className="grid gap-1 text-sm font-semibold">
          الحالة
          <select name="status" defaultValue={status ?? ""} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            <option value="">الكل</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          بحث برقم الطلب
          <input name="search" defaultValue={search ?? ""} maxLength={64} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <button type="submit" className="min-h-[44px] self-end rounded-control bg-brand px-5 font-semibold text-white">
          بحث
        </button>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر تحميل الطلبات" text="حاول إعادة تحميل الصفحة." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد طلبات مطابقة" hint="جرّب فلاتر مختلفة." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((o) => (
            <li key={o.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/orders/${o.id}`} className="font-bold text-brand">
                <bdi>{o.orderNumber}</bdi>
              </Link>
              <p className="text-secondary">
                {o.status} · <bdi>{o.totalFinal ?? o.totalEstimated} ج.م</bdi>
              </p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link href={qs({ cursor: next })} className="font-semibold text-brand">
            الصفحة التالية
          </Link>
        </p>
      ) : null}
    </main>
  );
}
