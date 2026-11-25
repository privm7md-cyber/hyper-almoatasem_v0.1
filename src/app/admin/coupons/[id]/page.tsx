// ADMIN COUPON DETAIL — one code, read and edited in place.
//
// The code carries no discount of its own: the kind of discount, the value and
// the rules all come from the offer it points at. So the screen shows the
// code's own facts next to the offer that gives it its meaning.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listCouponUsages } from "@/lib/promotions/queries";
import { getCouponAdmin } from "@/lib/promotions/admin-coupon-queries";
import { toAdminCoupon, toUsage } from "@/lib/promotions/serialize";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  promotionTypeLabel,
} from "@/lib/admin/terminology";
import {
  DataTable,
  EmptyState,
  KeyValue,
  Note,
  PageHead,
  Panel,
  Pill,
} from "@/components/admin/ui/surfaces";
import { PermissionGate } from "@/components/admin/permission-gate";
import { DangerDeleteButton } from "@/components/admin/promotion-forms";
import { CouponPatchForm } from "@/components/admin/coupon-patch-form";
import { CouponPreview } from "@/components/admin/coupon-preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل كود الخصم — لوحة إدارة هايبر المعتصم",
  robots: { index: false, follow: false },
};

export default async function AdminCouponDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePermission("coupons.view");
  const { id } = await params;
  const row = await getCouponAdmin(id).catch(() => null);
  if (!row) notFound();
  const coupon = toAdminCoupon(row);

  const usageRows = await listCouponUsages(coupon.id, { limit: 20, cursor: null }).catch(() => null);
  const usages = (usageRows ?? []).slice(0, 20).map(toUsage);

  return (
    <>
      <PageHead
        eyebrow="أكواد الخصم"
        title={coupon.code}
        intro="الكود مبياخدش خصم من نفسه — نوع الخصم وقيمته جايين من العرض اللي عليه. اللي هنا هو حدود الكود نفسه."
        actions={
          <Pill tone={coupon.status === "ACTIVE" ? "accent" : "warn"}>
            {coupon.statusLabel}
          </Pill>
        }
      />

      <Panel title="ملخص الكود" sub="الأرقام كما هي في قاعدة البيانات">
        <KeyValue
          items={[
            { label: "الكود", value: <span dir="ltr">{coupon.code}</span> },
            {
              label: "حالة التشغيل",
              value: (
                <Pill tone={coupon.status === "ACTIVE" ? "accent" : "warn"}>
                  {coupon.statusLabel}
                </Pill>
              ),
            },
            {
              label: "العرض اللي عليه",
              value: (
                <span className="adm-cell-main">
                  <span className="adm-cell-title">{coupon.offer.name}</span>
                  <span className="adm-cell-sub">
                    نوع الخصم: {promotionTypeLabel(coupon.offer.type)}
                    {coupon.offer.type === "PERCENTAGE" && coupon.offer.percent
                      ? ` — ${coupon.offer.percent}%`
                      : ""}
                    {coupon.offer.type === "FIXED_AMOUNT" && coupon.offer.amount
                      ? ` — ${formatMoney(coupon.offer.amount)}`
                      : ""}
                    {coupon.offer.maximumDiscount
                      ? ` — أقصى خصم ${formatMoney(coupon.offer.maximumDiscount)}`
                      : ""}
                  </span>
                </span>
              ),
            },
            {
              label: "عدد الاستخدامات",
              value:
                coupon.usageLimit === null
                  ? `${coupon.usedCount} — من غير حد`
                  : `${coupon.usedCount} من ${coupon.usageLimit}`,
            },
            {
              label: "إجمالي قيمة الخصومات الممنوحة",
              value: formatMoney(coupon.usage.totalDiscount),
            },
            {
              label: "عدد العملاء المميّزين",
              value:
                coupon.usage.distinctCustomers === 0
                  ? "لسه ولا عميل مسجّل"
                  : `${coupon.usage.distinctCustomers} عميل`,
            },
            {
              label: "آخر استخدام",
              value: coupon.usage.lastUsedAt ? formatDateTime(coupon.usage.lastUsedAt) : "لسه ما اتستخدمش",
            },
            {
              label: "حد الاستخدام لكل عميل",
              value:
                coupon.perCustomerLimit === null
                  ? "من غير حد"
                  : `${coupon.perCustomerLimit} مرة لكل عميل`,
            },
            {
              label: "أقل قيمة طلب",
              value: coupon.minimumOrderAmount
                ? formatMoney(coupon.minimumOrderAmount)
                : "من غير حد",
            },
            {
              label: "تاريخ البداية",
              value: coupon.startAt ? formatDate(coupon.startAt) : "من غير تاريخ محدد",
            },
            {
              label: "تاريخ النهاية",
              value: coupon.endAt ? formatDate(coupon.endAt) : "من غير تاريخ محدد",
            },
          ]}
        />
      </Panel>

      <Panel
        title="معاينة الكود"
        sub="المعاينة بتتحسب في الخادم بنفس قواعد الشراء — مفيش حساب في المتصفح"
      >
        <CouponPreview couponId={coupon.id} />
      </Panel>

      <Panel title="تعديل الكود" sub="الحدود وتاريخ التشغيل وحالة الكود">
        <PermissionGate
          permissions={admin.permissions}
          required="coupons.update"
          action="تعديل كود الخصم"
        >
          <CouponPatchForm
            id={coupon.id}
            usageLimit={coupon.usageLimit}
            perCustomerLimit={coupon.perCustomerLimit}
            minimumOrderAmount={coupon.minimumOrderAmount}
            startAt={coupon.startAt}
            endAt={coupon.endAt}
            isActive={coupon.isActive}
            canDisable={admin.permissions.includes("coupons.disable")}
          />
        </PermissionGate>
      </Panel>

      <Panel
        title="سجل الاستخدام"
        sub="كل طلب استخدم الكود ده وقيمة الخصم اللي اتخد"
        flush
      >
        {usageRows === null ? (
          <EmptyState title="مش قادرين نحمّل سجل الاستخدام" hint="جرّب تاني بعد شوية." />
        ) : usages.length === 0 ? (
          <EmptyState
            title="الكود لسه ما اتستخدمش"
            hint="أول ما عميل يستخدم الكود، الطلب يظهر هنا مع قيمة الخصم."
          />
        ) : (
          <DataTable
            caption="طلبات استخدمت كود الخصم ده"
            columns={[
              { header: "تاريخ الاستخدام" },
              { header: "رقم الطلب" },
              { header: "العميل" },
              { header: "قيمة الخصم", numeric: true },
            ]}
            rows={usages.map((usage) => [
              formatDateTime(usage.createdAt),
              <span key={`${usage.id}-order`} className="adm-cell-id" dir="ltr">
                {usage.orderId}
              </span>,
              usage.customerId ? (
                <span key={`${usage.id}-customer`} className="adm-cell-main">
                  <span className="adm-cell-title">عميل مسجّل</span>
                  <span className="adm-cell-id" dir="ltr">
                    {usage.customerId}
                  </span>
                </span>
              ) : (
                <span key={`${usage.id}-customer`} className="adm-cell-sub">
                  ضيف — طلب من غير حساب
                </span>
              ),
              formatMoney(usage.finalDiscount ?? usage.estimatedDiscount),
            ])}
            emptyLabel="الكود لسه ما اتستخدمش."
          />
        )}
      </Panel>

      <Panel title="حذف الكود" sub="الحذف نهائي، ومش هينفع لو الكود اتستخدم في طلبات">
        <PermissionGate
          permissions={admin.permissions}
          required="coupons.disable"
          action="حذف كود الخصم"
        >
          <DangerDeleteButton
            path={`/api/admin/coupons/${coupon.id}`}
            label="حذف الكود"
            confirmLabel="حذف الكود نهائي"
            question="الكود هيتحذف نهائيًا. لو اتخدم في طلبات، الحذف مش هينفع. تأكيد؟"
          />
        </PermissionGate>
      </Panel>

      <Note tone="info">
        الكود بيتخزن بحروف كبيرة ومن غير مسافات، والعميل بيكتبه زي ما هو. الكود بيشتغل بس لو هو نشط
        والعرض اللي وراه شغّال وداخل في تاريخه.
      </Note>
    </>
  );
}
