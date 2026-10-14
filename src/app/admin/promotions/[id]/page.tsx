// FE-10C promotion detail (server): full config view + rules/targets/buy-get/status/delete.
// Reads: promotions.view. Writes: promotions.update (status/rules/targets/buy-get/delete).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getPromotion } from "@/lib/promotions/queries";
import { toPromotion } from "@/lib/promotions/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { AdminAction } from "@/components/admin/admin-mutate";
import { BuyGetPutForm, PromotionStatusForm, RulesPutForm, TargetAddForm } from "@/components/admin/promotion-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل العرض — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminPromotionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("promotions.view");
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
      <AdminSection title="الحالة">
        <PromotionStatusForm id={promo.id} status={promo.status} />
      </AdminSection>
      <AdminSection title="الاستهداف">
        {promo.targets.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد أهداف — التفعيل يتطلب استهدافًا مكتملًا.</p>
        ) : (
          <ul className="grid gap-2">
            {promo.targets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-2 text-sm">
                <span>
                  {t.targetType} — <span className="font-mono text-xs" dir="ltr">{t.targetId}</span>
                </span>
                <AdminAction label="حذف الهدف" path={`/api/admin/promotions/${promo.id}/targets/${t.id}`} method="DELETE" />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <TargetAddForm promotionId={promo.id} />
        </div>
      </AdminSection>
      <AdminSection title="القواعد (minimums/caps)">
        <RulesPutForm promotionId={promo.id} />
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
        <AdminSection title="قاعدة الاشترِ-واحصل">
          <BuyGetPutForm promotionId={promo.id} />
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
      <AdminSection title="حذف العرض">
        <AdminAction
          label="حذف العرض نهائيًا"
          path={`/api/admin/promotions/${promo.id}`}
          method="DELETE"
          variant="danger"
          confirmText="الحذف نهائي للعروض غير المُشار إليها. تأكيد؟"
        />
      </AdminSection>
    </main>
  );
}
