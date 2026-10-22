// FE-10C promotion detail (server): full config view + rules/targets/buy-get/status/delete.
// Reads: promotions.view. Writes: promotions.update (status/rules/targets/buy-get/delete).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getPromotion } from "@/lib/promotions/queries";
import { toPromotion } from "@/lib/promotions/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { PermissionGate } from "@/components/admin/permission-gate";
import { AdminAction } from "@/components/admin/admin-mutate";
import { BuyGetPutForm, PromotionStatusForm, RulesPutForm, TargetAddForm } from "@/components/admin/promotion-forms";
import { PromotionDetailsForm } from "@/components/admin/promotion-details-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل العرض — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminPromotionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("promotions.view");
  const { id } = await params;
  const row = await getPromotion(id).catch(() => null);
  if (!row) notFound();
  const promo = toPromotion(row);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">{promo.name}</h1>
      <p className="text-sm text-secondary">
        {promo.type} · {promo.scope} · {promo.status} · أولوية {promo.priority} ·{" "}
        {promo.isStackable ? "قابل للجمع" : "غير قابل للجمع"} · مستخدم {promo.usedCount}
        {promo.usageLimit !== null ? ` من ${promo.usageLimit}` : ""}
      </p>
      {promo.description ? <p className="text-sm">{promo.description}</p> : null}
      <AdminSection title="بيانات العرض (promotions.update)">
        <PermissionGate permissions={admin.permissions} required="promotions.update" action="تعديل بيانات العرض">
          <PromotionDetailsForm
            promo={{
              id: promo.id,
              type: promo.type,
              name: promo.name,
              description: promo.description,
              priority: promo.priority,
              isStackable: promo.isStackable,
              usageLimit: promo.usageLimit,
              discountPercent: promo.discountPercent,
              discountAmount: promo.discountAmount,
              fixedPrice: promo.fixedPrice,
              startAt: promo.startAt,
              endAt: promo.endAt,
            }}
          />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="الحالة (promotions.disable)">
        <PermissionGate permissions={admin.permissions} required="promotions.disable" action="تغيير حالة العرض">
          <PromotionStatusForm id={promo.id} status={promo.status} />
        </PermissionGate>
      </AdminSection>
      <AdminSection title="الاستهداف (promotions.update)">
        {promo.targets.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد أهداف — التفعيل يتطلب استهدافًا مكتملًا.</p>
        ) : (
          <ul className="grid gap-2">
            {promo.targets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-2 text-sm">
                <span>
                  {t.targetType} — <span className="font-mono text-xs" dir="ltr">{t.targetId}</span>
                </span>
                <PermissionGate permissions={admin.permissions} required="promotions.update" action="حذف الهدف">
                  <AdminAction label="حذف الهدف" path={`/api/admin/promotions/${promo.id}/targets/${t.id}`} method="DELETE" />
                </PermissionGate>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <PermissionGate permissions={admin.permissions} required="promotions.update" action="إضافة الاستهداف">
            <TargetAddForm promotionId={promo.id} />
          </PermissionGate>
        </div>
      </AdminSection>
      <AdminSection title="القواعد (minimums/caps) — promotions.update">
        <PermissionGate permissions={admin.permissions} required="promotions.update" action="حفظ القواعد">
          <RulesPutForm promotionId={promo.id} />
        </PermissionGate>
        {promo.rules ? (
          <p className="text-sm text-secondary">
            الحالية: كمية {promo.rules.minimumQuantity ?? "—"} · مبلغ {promo.rules.minimumAmount ?? "—"} · سقف{" "}
            {promo.rules.maximumDiscount ?? "—"}
          </p>
        ) : (
          <p className="text-sm text-secondary">لا توجد قواعد محفوظة.</p>
        )}
      </AdminSection>
      {promo.type === "BUY_X_GET_Y" ? (
        <AdminSection title="قاعدة الاشترِ-واحصل (promotions.update)">
          <PermissionGate permissions={admin.permissions} required="promotions.update" action="حفظ قاعدة الاشترِ-واحصل">
            <BuyGetPutForm promotionId={promo.id} />
          </PermissionGate>
          {promo.buyGet ? (
            <p className="text-sm text-secondary">
              الحالية: اشترِ {promo.buyGet.buyQuantity} واحصل على {promo.buyGet.getQuantity} بخصم{" "}
              {promo.buyGet.discountPercent}%
            </p>
          ) : (
            <p className="text-sm text-secondary">لا توجد قاعدة محفوظة.</p>
          )}
        </AdminSection>
      ) : null}
      <AdminSection title="حذف العرض (promotions.disable)">
        <PermissionGate permissions={admin.permissions} required="promotions.disable" action="حذف العرض">
          <AdminAction
            label="حذف العرض نهائيًا"
            path={`/api/admin/promotions/${promo.id}`}
            method="DELETE"
            variant="danger"
            confirmText="الحذف نهائي للعروض غير المُشار إليها. تأكيد؟"
          />
        </PermissionGate>
      </AdminSection>
    </main>
  );
}
