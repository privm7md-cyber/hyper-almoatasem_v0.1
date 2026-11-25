// ADMIN COUPONS LIST — the codes the customer types at checkout.
//
// A code has no discount of its own: it borrows the kind of discount, the
// value and the rules from the offer it points at. So the list shows the code,
// its own state, the offer it rides on, and the limits that belong to the code
// alone.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listCouponOfferOptions } from "@/lib/promotions/queries";
import { listCouponsAdmin } from "@/lib/promotions/admin-coupon-queries";
import { toAdminCoupon } from "@/lib/promotions/serialize";
import { COUPON_STATUS_RULES, type CouponStatusValue } from "@/lib/promotions/coupon-status";
import { formatDate, formatMoney } from "@/lib/admin/terminology";
import {
  DataTable,
  EmptyState,
  ErrorState,
  Note,
  PageHead,
  Panel,
  Pager,
  Pill,
} from "@/components/admin/ui/surfaces";
import { PermissionGate } from "@/components/admin/permission-gate";
import { CouponCreateForm, type CouponOfferOption } from "@/components/admin/coupon-forms";
import { AdminRetryButton } from "@/components/admin/ui/controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "أكواد الخصم — لوحة إدارة هايبر المعتصم",
  robots: { index: false, follow: false },
};

const LIMIT = 20;
const OFFER_LIMIT = 200;

/** The status filter options come from the SAME rule list the badge uses. */
const STATUS_OPTIONS: Array<{ value: CouponStatusValue; label: string }> = COUPON_STATUS_RULES.map(
  (rule) => ({ value: rule.status, label: rule.labelAr }),
);

export default async function AdminCouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; active?: string; status?: string; cursor?: string }>;
}) {
  const admin = await requirePermission("coupons.view");
  const sp = await searchParams;
  const search =
    typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 64) : null;
  const active = sp.active === "true" ? true : sp.active === "false" ? false : null;
  const status =
    typeof sp.status === "string" && STATUS_OPTIONS.some((option) => option.value === sp.status)
      ? (sp.status as CouponStatusValue)
      : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;

  let rows: ReturnType<typeof toAdminCoupon>[] | null = null;
  let nextCursor: string | null = null;
  try {
    const found = await listCouponsAdmin({
      limit: LIMIT,
      cursor,
      search: search ? search.toUpperCase() : null,
      active,
      status,
    });
    // The cursor is the last row this page shows, so the next page starts exactly here.
    const page = found.length > LIMIT ? found.slice(0, LIMIT) : found;
    nextCursor = found.length > LIMIT ? page[page.length - 1].id : null;
    rows = page.map(toAdminCoupon);
  } catch {
    rows = null;
  }

  // This prerequisite read is independent of the coupon list and its filters.
  let creationOffers: CouponOfferOption[] | null = null;
  let hasMoreOffers = false;
  if (admin.permissions.includes("coupons.create")) {
    try {
      const found = await listCouponOfferOptions();
      hasMoreOffers = found.length > OFFER_LIMIT;
      creationOffers = found.slice(0, OFFER_LIMIT);
    } catch {
      creationOffers = null;
    }
  }

  return (
    <>
      <PageHead
        eyebrow="أكواد الخصم"
        title="أكواد الخصم"
        intro="الكود نفسه لا يملك خصمًا مستقلًا، بل يرتبط بعرض قائم يستمد منه نوع الخصم وقيمته. من هنا تدير حالة الكود، وعدد مرات استخدامه، وحدوده."
      />

      <form method="get" action="/admin/coupons" className="adm-filters">
        <div className="adm-filters-grid">
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="coupon-search">
              بحث بالكود
            </label>
            <input
              id="coupon-search"
              name="search"
              type="search"
              defaultValue={search ?? ""}
              maxLength={64}
              placeholder="اكتب الكود…"
              className="adm-input"
              dir="ltr"
            />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="coupon-active">
              حالة الكود
            </label>
            <select id="coupon-active" name="active" defaultValue={active === null ? "" : String(active)} className="adm-select">
              <option value="">كل الحالات</option>
              <option value="true">مفعّل</option>
              <option value="false">موقوف</option>
            </select>
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="coupon-status">
              حالة التشغيل
            </label>
            <select id="coupon-status" name="status" defaultValue={status ?? ""} className="adm-select">
              <option value="">كل الحالات</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-field">
            <button type="submit" className="adm-btn adm-btn--secondary">
              بحث
            </button>
          </div>
        </div>
      </form>

      <Panel title="كل أكواد الخصم" sub="كل الأكواد المسجلة، مع حالة كل كود" flush>
        {rows === null ? (
          <ErrorState
            title="مش قادرين نحمّل أكواد الخصم دلوقتي"
            hint="في مشكلة في قاعدة البيانات. جرّب تاني بعد شوية."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="مفيش أكواد خصم مطابقة"
            hint="غيّر البحث أو الفلتر، أو اعمل كود جديد من تحت."
          />
        ) : (
          <DataTable
            caption="أكواد الخصم مع العرض اللي عليها وحالتها وحدودها"
            columns={[
              { header: "الكود" },
              { header: "حالة التشغيل" },
              { header: "العرض اللي عليه" },
              { header: "عدد الاستخدامات", numeric: true },
              { header: "قيمة الخصومات الممنوحة", numeric: true },
              { header: "الحد الأقصى للاستخدام", numeric: true },
              { header: "أقل قيمة طلب", numeric: true },
              { header: "تاريخ البداية والنهاية" },
            ]}
            rows={rows.map((row) => [
              <Link
                key={`${row.id}-code`}
                href={`/admin/coupons/${row.id}`}
                className="adm-cell-title"
                dir="ltr"
              >
                {row.code}
              </Link>,
              <Pill key={`${row.id}-state`} tone={row.status === "ACTIVE" ? "accent" : "warn"}>
                {row.statusLabel}
              </Pill>,
              <span key={`${row.id}-offer`} className="adm-cell-main">
                <span className="adm-cell-title">{row.offer.name}</span>
                <span className="adm-cell-sub">
                  {row.offer.type === "PERCENTAGE"
                    ? `${row.offer.percent ?? "0"}%`
                    : row.offer.type === "FIXED_AMOUNT"
                      ? formatMoney(row.offer.amount)
                      : row.offer.type}
                </span>
              </span>,
              row.usedCount,
              formatMoney(row.usage.totalDiscount),
              row.usageLimit === null ? "من غير حد" : row.usageLimit,
              row.minimumOrderAmount ? formatMoney(row.minimumOrderAmount) : "من غير حد",
              row.startAt || row.endAt
                ? `${formatDate(row.startAt)} — ${formatDate(row.endAt)}`
                : "من غير تاريخ محدد",
            ])}
            emptyLabel="مفيش أكواد خصم مطابقة."
          />
        )}
      </Panel>

      <Pager
        basePath="/admin/coupons"
        params={{
          search: search ?? undefined,
          active: active === null ? undefined : String(active),
          status: status ?? undefined,
        }}
        nextCursor={nextCursor}
        label="كود خصم"
      />

      <Panel title="كود خصم جديد" sub="الكود بيتربط بعرض موجود، وبياخد منه نوع الخصم والقيمة">
        <PermissionGate
          permissions={admin.permissions}
          required="coupons.create"
          action="إضافة كود خصم"
        >
          {creationOffers === null ? (
            <ErrorState
              title="مش قادرين نحمّل العروض لإنشاء الكود دلوقتي"
              hint={
                <>
                  تعذّر تحميل اختيارات العرض. جرّب تحميل الصفحة تاني. {" "}
                  <AdminRetryButton />
                </>
              }
            />
          ) : (
            <>
              {creationOffers.length === 0 ? (
                <EmptyState
                  title="لازم يكون فيه عرض موجود قبل إنشاء كود خصم"
                  hint={
                    admin.permissions.includes("promotions.view")
                      ? "افتح العروض عشان تجهّز العرض اللي هتربط بيه الكود."
                      : "كلّم مسؤول العروض عشان يجهّز عرض تربط بيه الكود."
                  }
                  action={
                    admin.permissions.includes("promotions.view") ? (
                      <Link href="/admin/promotions" className="adm-btn adm-btn--secondary">
                        افتح العروض
                      </Link>
                    ) : null
                  }
                />
              ) : null}
              {hasMoreOffers ? (
                <Note tone="info">
                  فيه أكتر من 200 عرض. الاختيارات هنا بتعرض أول 200 عرض بالاسم بس.
                </Note>
              ) : null}
              <CouponCreateForm offers={creationOffers} />
            </>
          )}
        </PermissionGate>
      </Panel>

      <Note tone="info">
        الكود بيتخزن بحروف كبيرة ومن غير مسافات، والعميل بيكتبه زي ما هو. لو العرض اللي ورا الكود اتوقف أو
        خلصت مدته، الكود مش هيشتغل حتى لو هو نفسه نشط.
      </Note>
    </>
  );
}
