// FE-10E admin order detail (server): lines + transitions + replacements + credential ops.
// Reads: orders.view. Writes: orders.update (all transitions/proposals) + orders.cancel.
// Buttons render per current status; server re-gates everything (409-safe).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getOrderFull } from "@/lib/orders/queries";
import { toOrder } from "@/lib/orders/serialize";
import { listReplacementsByOrder } from "@/lib/replacements/queries";
import { toReplacement } from "@/lib/replacements/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { AdminAction } from "@/components/admin/admin-mutate";
import { PickForm, ProposeForm } from "@/components/admin/fulfillment-forms";
import { EmptyState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الطلب — الإدارة",
  robots: { index: false, follow: false },
};

const TRANSITIONS: { from: string[]; label: string; path: (id: string) => string; method: "POST"; confirm?: string }[] = [
  { from: ["CONFIRMED"], label: "بدء التجهيز", path: (id) => `/api/admin/orders/${id}/prepare`, method: "POST" },
  { from: ["PREPARING"], label: "إتمام التجهيز (READY)", path: (id) => `/api/admin/orders/${id}/ready`, method: "POST" },
  {
    from: ["READY_FOR_DELIVERY"],
    label: "إرسال للتوصيل",
    path: (id) => `/api/admin/orders/${id}/dispatch`,
    method: "POST",
  },
  { from: ["OUT_FOR_DELIVERY"], label: "تأكيد التسليم", path: (id) => `/api/admin/orders/${id}/deliver`, method: "POST" },
  {
    from: ["NEW", "CONFIRMED", "PREPARING"],
    label: "إلغاء الطلب",
    path: (id) => `/api/admin/orders/${id}/cancel`,
    method: "POST",
    confirm: "إلغاء الطلب نهائي للطلبات غير المجهّزة. تأكيد؟",
  },
];

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("orders.view");
  const { id } = await params;
  const row = await getOrderFull(id).catch(() => null);
  if (!row) notFound();
  const order = toOrder(row);
  const replacements = ((await listReplacementsByOrder(id).catch(() => null)) ?? []).map(toReplacement);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">
        الطلب <bdi>{order.orderNumber}</bdi> · {order.status}
      </h1>
      <AdminSection title="السطور">
        {order.items.length === 0 ? (
          <EmptyState title="لا توجد سطور" hint="" />
        ) : (
          <ul className="grid gap-2">
            {order.items.map((item) => (
              <li key={item.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <p className="font-bold">
                  {item.productName} ({item.variantName})
                </p>
                <p className="text-secondary">
                  مطلوب: <bdi>{item.requestedQuantity}</bdi>
                  {item.actualQuantity !== null ? (
                    <>
                      {" · "}فعلي: <bdi>{item.actualQuantity}</bdi>
                    </>
                  ) : null}
                  {" · "}الحالة: {item.itemStatus}
                </p>
                {order.status === "PREPARING" && (item.itemStatus === "PENDING" || item.itemStatus === "UNAVAILABLE") ? (
                  <div className="mt-2 grid gap-2">
                    <PickForm orderId={order.id} itemId={item.id} />
                    <AdminAction
                      label="تعليم غير متوفر"
                      path={`/api/admin/orders/${order.id}/items/${item.id}/unavailable`}
                      method="POST"
                    />
                    <ProposeForm orderId={order.id} itemId={item.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
      <AdminSection title="الانتقالات المسموحة للحالة الحالية">
        <div className="flex flex-wrap gap-2">
          {TRANSITIONS.filter((t) => t.from.includes(order.status)).map((t) => (
            <AdminAction key={t.label} label={t.label} path={t.path(order.id)} method={t.method} confirmText={t.confirm} />
          ))}
          {TRANSITIONS.every((t) => !t.from.includes(order.status)) ? (
            <p className="text-sm text-secondary">لا توجد انتقالات متاحة من هذه الحالة.</p>
          ) : null}
        </div>
      </AdminSection>
      <AdminSection title="البدائل">
        {replacements.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد اقتراحات.</p>
        ) : (
          <ul className="grid gap-2">
            {replacements.map((r) => (
              <li key={r.id} className="rounded-card border border-line bg-white p-3 text-sm">
                <p>
                  {r.original.productName} ← {r.substitute.productName} (<bdi>{r.replacementUnitPrice} ج.م</bdi>)
                </p>
                <p className="font-semibold">
                  {r.status}
                  {r.decidedByType ? ` · القرار: ${r.decidedByType}` : ""}
                </p>
                {r.status === "PROPOSED" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <AdminAction label="سحب الاقتراح" path={`/api/admin/replacements/${r.id}/withdraw`} method="POST" />
                    <AdminAction label="قبول تلقائي" path={`/api/admin/replacements/${r.id}/auto-accept`} method="POST" confirmText="قبول تلقائي يطبّق البديل. تأكيد؟" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
      <AdminSection title="اعتماد طلب الضيف">
        <div className="flex flex-wrap gap-2">
          <AdminAction label="تدوير الاعتماد" path={`/api/admin/orders/${order.id}/credential/rotate`} method="POST" confirmText="تدوير يبطل الاعتماد الحالي. تأكيد؟" />
          <AdminAction label="إلغاء الاعتماد" path={`/api/admin/orders/${order.id}/credential/revoke`} method="POST" confirmText="الإلغاء يمنع الوصول. تأكيد؟" />
        </div>
      </AdminSection>
    </main>
  );
}
