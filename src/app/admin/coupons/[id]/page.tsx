// FE-10C coupon detail (server): config + active toggle + usages + delete.
// Reads: coupons.view. Writes: coupons.update (patch) / coupons.disable via PATCH shape.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getCoupon, listCouponUsages } from "@/lib/promotions/queries";
import { toCoupon, toUsage } from "@/lib/promotions/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { AdminAction } from "@/components/admin/admin-mutate";
import { CouponPatchForm } from "@/components/admin/coupon-patch-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل الكوبون — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminCouponDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("coupons.view");
  const { id } = await params;
  const row = await getCoupon(id).catch(() => null);
  if (!row) notFound();
  const coupon = toCoupon(row);
  const usages = await listCouponUsages(id, { limit: 20, cursor: null }).catch(() => null);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">
        كوبون <bdi>{coupon.code}</bdi>
      </h1>
      <p className="text-sm text-secondary">
        العرض: <span className="font-mono text-xs" dir="ltr">{coupon.promotionId}</span> · مستخدم{" "}
        {coupon.usedCount}
        {coupon.perCustomerLimit !== null ? ` · حد العميل: ${coupon.perCustomerLimit}` : ""} ·{" "}
        {coupon.isActive ? "نشط" : "موقوف"}
      </p>
      <AdminSection title="تعديل (coupons.update)">
        <CouponPatchForm
          id={coupon.id}
          usageLimit={coupon.usageLimit}
          perCustomerLimit={coupon.perCustomerLimit}
          minimumOrderAmount={coupon.minimumOrderAmount}
          isActive={coupon.isActive}
        />
      </AdminSection>
      <AdminSection title="الاستخدامات">
        {!usages || usages.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد استخدامات مسجلة.</p>
        ) : (
          <ul className="grid gap-2">
            {usages.slice(0, 20).map((u) => {
              const s = toUsage(u);
              return (
                <li key={s.id} className="rounded-card border border-line bg-white p-2 text-sm">
                  طلب <span className="font-mono text-xs" dir="ltr">{s.orderId}</span> · خصم{" "}
                  <bdi>{s.finalDiscount ?? s.estimatedDiscount} ج.م</bdi>
                </li>
              );
            })}
          </ul>
        )}
      </AdminSection>
      <AdminSection title="حذف الكوبون">
        <AdminAction
          label="حذف الكوبون"
          path={`/api/admin/coupons/${coupon.id}`}
          method="DELETE"
          variant="danger"
          confirmText="حذف الكوبون نهائي. تأكيد؟"
        />
      </AdminSection>
    </main>
  );
}
