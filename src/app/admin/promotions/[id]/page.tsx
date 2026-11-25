// ADMIN PROMOTION DETAIL — one offer, read and edited in place.
//
// The screen answers three questions in this order: what the offer is, what it
// does to the order, and which products it sits on. Every target is shown with
// the real name of the product it points at — a machine id alone would tell the
// operator nothing about what the discount actually covers.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getPromotion } from "@/lib/promotions/queries";
import { toPromotion } from "@/lib/promotions/serialize";
import { previewPromotion } from "@/lib/promotions/admin-preview";
import { getBrand, getCategory, getProduct, getVariant } from "@/lib/catalog/queries";
import {
  formatDate,
  formatMoney,
  formatQuantity,
  promotionEffectiveStatus,
  promotionEffectiveStatusLabel,
  promotionScopeLabel,
  promotionScopeMeaning,
  promotionStatusLabel,
  promotionTargetLabel,
  promotionTypeLabel,
  sizeUnitLabel,
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
import { NameBadge } from "@/components/admin/name-badge";
import {
  BuyGetPutForm,
  DangerDeleteButton,
  PromotionStatusForm,
  RulesPutForm,
  TargetAddForm,
} from "@/components/admin/promotion-forms";
import { PromotionDetailsForm } from "@/components/admin/promotion-details-form";
import { PromotionPricePreview } from "@/components/admin/promotion-preview";
import { PromotionCatalogPicker } from "@/components/admin/promotion-catalog-picker";
import { loadPromotionCatalog } from "@/lib/admin/promotion-catalog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل العرض — لوحة إدارة هايبر المعتصم",
  robots: { index: false, follow: false },
};

const STATUS_TONE: Record<string, "accent" | "info" | "warn" | "neutral"> = {
  ACTIVE: "accent",
  DRAFT: "info",
  DISABLED: "warn",
};

/** The tone of the EFFECTIVE state (a finished offer is not "running"). */
const EFFECTIVE_TONE: Record<string, "accent" | "info" | "warn" | "neutral"> = {
  LIVE: "accent",
  SCHEDULED: "info",
  DRAFT: "info",
  EXPIRED: "neutral",
  DISABLED: "warn",
};

/** A target that no longer resolves still has to be shown honestly. */
const UNRESOLVED = "الاسم محتاج مراجعة";

/** The discount the offer carries, read by its own kind. */
function discountValue(
  type: string,
  percent: string | null,
  amount: string | null,
  fixedPrice: string | null,
): string {
  if (type === "PERCENTAGE") return percent ? `${formatQuantity(percent)}%` : "من غير قيمة";
  if (type === "FIXED_AMOUNT") return amount ? formatMoney(amount) : "من غير قيمة";
  if (type === "FIXED_PRICE") return fixedPrice ? formatMoney(fixedPrice) : "من غير قيمة";
  return "الكمية والنسبة في قاعدة اشترِ واحصل";
}

/** The real name of whatever the target points at, resolved from the catalogue. */
async function resolveTarget(
  targetType: string,
  targetId: string,
): Promise<{ name: string | null; context: string | null }> {
  try {
    if (targetType === "VARIANT") {
      const variant = await getVariant(targetId, true);
      if (!variant) return { name: null, context: null };
      const product = await getProduct(variant.productId, true);
      const size = variant.sizeValue
        ? ` — ${formatQuantity(variant.sizeValue.toString())}${variant.sizeUnit ? ` ${sizeUnitLabel(variant.sizeUnit)}` : ""}`
        : "";
      return { name: `${variant.name}${size}`, context: product ? `منتج: ${product.name}` : null };
    }
    if (targetType === "PRODUCT") {
      const product = await getProduct(targetId, true);
      if (!product) return { name: null, context: null };
      return {
        name: product.name,
        context: product.brand ? `علامة تجارية: ${product.brand.name}` : null,
      };
    }
    if (targetType === "BRAND") {
      const brand = await getBrand(targetId, true);
      return { name: brand?.name ?? null, context: null };
    }
    if (targetType === "CATEGORY") {
      const category = await getCategory(targetId, true);
      return { name: category?.name ?? null, context: null };
    }
  } catch {
    return { name: null, context: null };
  }
  return { name: null, context: null };
}

export default async function AdminPromotionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePermission("promotions.view");
  const { id } = await params;
  const row = await getPromotion(id).catch(() => null);
  if (!row) notFound();
  const promo = toPromotion(row);

  const targets = await Promise.all(
    promo.targets.map(async (target) => {
      const resolved = await resolveTarget(target.targetType, target.targetId);
      return { ...target, ...resolved };
    }),
  );

  const freeVariant = promo.buyGet?.freeVariantId
    ? await resolveTarget("VARIANT", promo.buyGet.freeVariantId)
    : null;

  const value = discountValue(promo.type, promo.discountPercent, promo.discountAmount, promo.fixedPrice);

  // The effective state is what the offer is DOING now: an ACTIVE offer whose
  // window already closed is finished, and the panel must say so.
  const now = new Date();
  const effectiveStatus = promotionEffectiveStatus(promo.status, promo.startAt, promo.endAt, now);
  const effectiveLabel = promotionEffectiveStatusLabel(promo.status, promo.startAt, promo.endAt, now);

  // The preview runs the checkout pricing engine (read-only). Prices are a
  // separate capability, so an account without it never sees a number here.
  const canSeePrices = admin.permissions.includes("prices.view");
  const preview = canSeePrices
    ? await previewPromotion({ promotionId: promo.id, variantIds: null, override: null, now }).catch(() => null)
    : null;

  // The catalogue the owner picks the offer's products from.
  const rawSearchParams = await searchParams;
  const pickParam = rawSearchParams.pick;
  const pickSearch = (Array.isArray(pickParam) ? pickParam[0] : pickParam ?? "").trim().slice(0, 80);
  let catalogRows: Awaited<ReturnType<typeof loadPromotionCatalog>> = [];
  let catalogFailed = false;
  try {
    catalogRows = await loadPromotionCatalog(pickSearch);
  } catch {
    catalogFailed = true;
  }

  return (
    <>
      <PageHead
        eyebrow="العروض"
        title={promo.name}
        intro="كل حاجة عن العرض: نوع الخصم، على إيه بيتحسب، المنتجات المستهدفة، وحالته."
        actions={
          <Pill tone={EFFECTIVE_TONE[effectiveStatus] ?? "neutral"}>
            {effectiveLabel}
          </Pill>
        }
      />

      <Panel title="ملخص العرض" sub="الأرقام كما هي في قاعدة البيانات">
        <KeyValue
          items={[
            { label: "نوع الخصم", value: promotionTypeLabel(promo.type) },
            {
              label: "على إيه بيتحسب",
              value: (
                <span className="adm-cell-main">
                  <span className="adm-cell-title">{promotionScopeLabel(promo.scope)}</span>
                  <span className="adm-cell-sub">{promotionScopeMeaning(promo.scope)}</span>
                </span>
              ),
            },
            { label: "قيمة الخصم", value },
            {
              label: "الحالة",
              value: (
                <span className="adm-cell-main">
                  <span className="adm-cell-title">
                    <Pill tone={EFFECTIVE_TONE[effectiveStatus] ?? "neutral"}>{effectiveLabel}</Pill>
                  </span>
                  <span className="adm-cell-sub">
                    <Pill tone={STATUS_TONE[promo.status] ?? "neutral"}>
                      {promotionStatusLabel(promo.status)}
                    </Pill>
                    {effectiveStatus === "SCHEDULED" ? " — لسه ما بدأش." : null}
                    {effectiveStatus === "EXPIRED" ? " — خلص وقته." : null}
                  </span>
                </span>
              ),
            },
            { label: "الأولوية", value: promo.priority },
            { label: "تاريخ البداية", value: promo.startAt ? formatDate(promo.startAt) : "من غير تاريخ محدد" },
            { label: "تاريخ النهاية", value: promo.endAt ? formatDate(promo.endAt) : "من غير تاريخ محدد" },
            {
              label: "الحد الأدنى للكمية",
              value: promo.rules?.minimumQuantity ? formatQuantity(promo.rules.minimumQuantity) : "من غير حد",
            },
            {
              label: "الحد الأدنى لقيمة الطلب",
              value: promo.rules?.minimumAmount ? formatMoney(promo.rules.minimumAmount) : "من غير حد",
            },
            {
              label: "أقصى قيمة خصم",
              value: promo.rules?.maximumDiscount ? formatMoney(promo.rules.maximumDiscount) : "من غير سقف",
            },
            {
              label: "عدد مرات الاستخدام",
              value:
                promo.usageLimit === null
                  ? `${promo.usedCount} — من غير حد`
                  : `${promo.usedCount} من ${promo.usageLimit}`,
            },
            {
              label: "أولوية العرض عند التعارض",
              value: "العرض صاحب الأولوية الأعلى هو اللي بيحسب — العروض ماتتجمّعش مع بعض.",
            },
            ...(promo.buyGet
              ? [
                  {
                    label: "قاعدة اشترِ واحصل",
                    value: `اشترِ ${formatQuantity(promo.buyGet.buyQuantity)} واحصل على ${formatQuantity(promo.buyGet.getQuantity)} بخصم ${formatQuantity(promo.buyGet.discountPercent)}%`,
                  },
                ]
              : []),
            ...(promo.buyGet?.freeVariantId
              ? [
                  {
                    label: "شكل بيع تاني للمجاني",
                    value: (
                      <span className="adm-cell-main">
                        <span className="adm-cell-title">{freeVariant?.name ?? UNRESOLVED}</span>
                        {freeVariant?.context ? (
                          <span className="adm-cell-sub">{freeVariant.context}</span>
                        ) : null}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      <Panel
        title="الاستهداف"
        sub="المنتجات أو التصنيفات أو العلامات اللي العرض بيخصم عليها"
        flush
      >
        {targets.length === 0 ? (
          <EmptyState
            title="مفيش حاجة مستهدفة"
            hint="العرض اللي بيخصم على منتجات مش هيتفعّل من غير استهداف. ضيف منتج أو تصنيف من تحت."
          />
        ) : (
          <DataTable
            caption="الحاجات اللي العرض بيتطبّق عليها"
            columns={[
              { header: "نوع الحاجة المستهدفة" },
              { header: "الحاجة المستهدفة" },
              { header: "إزالة" },
            ]}
            rows={targets.map((target) => [
              <Pill key={`${target.id}-type`} tone="outline">
                {promotionTargetLabel(target.targetType)}
              </Pill>,
              <span key={`${target.id}-name`} className="adm-cell-main">
                <span className="adm-cell-title">{target.name ?? UNRESOLVED}</span>
                {target.name ? <NameBadge name={target.name} /> : null}
                {target.context ? <span className="adm-cell-sub">{target.context}</span> : null}
                <span className="adm-cell-id" dir="ltr">
                  {target.targetId}
                </span>
              </span>,
              <PermissionGate
                key={`${target.id}-remove`}
                permissions={admin.permissions}
                required="promotions.update"
                action="إزالة الاستهداف"
              >
                <DangerDeleteButton
                  path={`/api/admin/promotions/${promo.id}/targets/${target.id}`}
                  label="إزالة"
                  confirmLabel="إزالة الاستهداف"
                  question="الاستهداف هيتشال من العرض، والعرض هيشتغل من غيره. تأكيد؟"
                />
              </PermissionGate>,
            ])}
          />
        )}
      </Panel>

      <Panel
        title="اختيار منتجات من الكتالوج"
        sub="دوّر على المنتج بالاسم زي ما بتدور في المتجر، وضيفه للعرض بضغطة واحدة"
      >
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.update"
          action="إضافة منتج للعرض"
        >
          <PromotionCatalogPicker
            promotionId={promo.id}
            search={pickSearch}
            rows={catalogRows}
            targetedProductIds={promo.targets
              .filter((t) => t.targetType === "PRODUCT")
              .map((t) => t.targetId)}
            canSeePrices={canSeePrices}
            failed={catalogFailed}
          />
        </PermissionGate>
      </Panel>

      <Panel title="إضافة استهداف" sub="اختار نوع الحاجة والصق الرقم الداخلي بتاعها">
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.update"
          action="إضافة استهداف"
        >
          <TargetAddForm promotionId={promo.id} />
        </PermissionGate>
      </Panel>

      <Panel
        title="معاينة السعر"
        sub="الأرقام دي بتيجي من محرك التسعير نفسه اللي بيحسب الطلبات — مش تقدير في المتصفح"
      >
        {canSeePrices ? (
          preview && preview.rows.length > 0 ? (
            <PromotionPricePreview
              promotionId={promo.id}
              type={promo.type}
              initialValue={
                promo.type === "PERCENTAGE"
                  ? (promo.discountPercent ?? "")
                  : promo.type === "FIXED_AMOUNT"
                    ? (promo.discountAmount ?? "")
                    : promo.type === "FIXED_PRICE"
                      ? (promo.fixedPrice ?? "")
                      : ""
              }
              initialRows={preview.rows}
              offerStateLabel={effectiveLabel}
            />
          ) : (
            <EmptyState
              title="مفيش حاجة تتعمل عليها معاينة"
              hint="العرض لسه مفيش عليه منتجات مستهدفة، أو مفيش منتجات تقدر تتعمل عليها معاينة. ضيف منتجات الأول من الكتالوج فوق."
            />
          )
        ) : (
          <Note tone="info">
            معاينة الأسعار محتاجة صلاحية «عرض الأسعار». الحساب ده يقدر يعدّل العرض من غير ما يشوف الأرقام.
          </Note>
        )}
      </Panel>

      <Panel title="حالة العرض" sub="العرض بيشتغل على الطلبات بس وهو شغّال وداخل في تاريخه">
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.disable"
          action="تغيير حالة العرض"
        >
          <PromotionStatusForm id={promo.id} status={promo.status} />
        </PermissionGate>
      </Panel>

      <Panel title="بيانات العرض" sub="الاسم والوصف والأولوية وحد الاستخدام وقيمة الخصم">
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.update"
          action="تعديل بيانات العرض"
        >
          <PromotionDetailsForm
            promo={{
              id: promo.id,
              type: promo.type,
              name: promo.name,
              description: promo.description,
              priority: promo.priority,
              usageLimit: promo.usageLimit,
              discountPercent: promo.discountPercent,
              discountAmount: promo.discountAmount,
              fixedPrice: promo.fixedPrice,
              startAt: promo.startAt,
              endAt: promo.endAt,
            }}
          />
        </PermissionGate>
      </Panel>

      <Panel title="قواعد العرض" sub="أقل كمية وأقل قيمة طلب وأقصى قيمة خصم">
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.update"
          action="حفظ قواعد العرض"
        >
          <RulesPutForm
            promotionId={promo.id}
            initial={{
              minimumQuantity: promo.rules?.minimumQuantity ?? null,
              minimumAmount: promo.rules?.minimumAmount ?? null,
              maximumDiscount: promo.rules?.maximumDiscount ?? null,
            }}
          />
        </PermissionGate>
      </Panel>

      {promo.type === "BUY_X_GET_Y" ? (
        <Panel title="قاعدة اشترِ واحصل" sub="كمية الشراء وكمية المجاني ونسبة الخصم عليها">
          <PermissionGate
            permissions={admin.permissions}
            required="promotions.update"
            action="حفظ قاعدة اشترِ واحصل"
          >
            <BuyGetPutForm
              promotionId={promo.id}
              initial={{
                buyQuantity: promo.buyGet?.buyQuantity ?? null,
                getQuantity: promo.buyGet?.getQuantity ?? null,
                discountPercent: promo.buyGet?.discountPercent ?? null,
                freeVariantId: promo.buyGet?.freeVariantId ?? null,
              }}
            />
          </PermissionGate>
        </Panel>
      ) : null}

      <Panel title="حذف العرض" sub="الحذف نهائي، ومش هينفع لو طلبات استعملت العرض">
        <PermissionGate
          permissions={admin.permissions}
          required="promotions.disable"
          action="حذف العرض"
        >
          <DangerDeleteButton
            path={`/api/admin/promotions/${promo.id}`}
            label="حذف العرض"
            confirmLabel="حذف العرض نهائي"
            question="العرض هيتحذف نهائيًا. لو عليه طلبات اتعملت، الحذف مش هينفع. تأكيد؟"
          />
        </PermissionGate>
      </Panel>

      <Note tone="warn">
        لما طلبات تستخدم العرض، أرقامه مش بتتغير تاني — الخصم والقيم والخطط بتتخدق. اعمل عرض جديد بالقيمة
        الجديدة وسيب العرض القديم زي ما هو.
      </Note>
    </>
  );
}
