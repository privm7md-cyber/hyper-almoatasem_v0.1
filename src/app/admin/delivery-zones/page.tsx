// ADMIN DELIVERY ZONES — the areas the store delivers to (server).
//
// A zone is an area the store delivers to, with its own delivery fee. The
// store matches the customer's address against the active zones and charges
// that zone's fee; when no zone matches, the default fee applies. There is no
// distance calculation and no guessing from the address text.
//
// One page of rows at a time: the browser never receives the whole list. The
// order is by name with a stable id tiebreak and the cursor is minted from the
// LAST KEPT row of the page, so nothing is skipped and nothing shows twice.

import type { Metadata } from "next";
import Link from "next/link";
import type { DeliveryZone, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermissionAny } from "@/lib/auth/rbac";
import { decodeCursor, encodeCursor, pageOrder, pageWhereName, type PageCursor } from "@/lib/api/pagination";
import { getSetting } from "@/lib/admin/queries";
import { loadDeliveryScopes } from "@/lib/admin/delivery-zones";
import { formatMoney, settingLabel } from "@/lib/admin/terminology";
import { PermissionGate } from "@/components/admin/permission-gate";
import { DeliveryZoneActions, DeliveryZoneCreateForm, type DeliveryZoneView } from "@/components/admin/delivery-zone-forms";
import { DataTable, ErrorState, Note, PageHead, Panel, Pager, Pill } from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "مناطق التوصيل — الإدارة",
  robots: { index: false, follow: false },
};

const LIMIT = 20;

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminDeliveryZonesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  // E-3 closure: the screen is gated by the dedicated `delivery.view`
  // capability OR the broader `settings.view` one (same rule as the API).
  const admin = await requirePermissionAny(["delivery.view", "settings.view"]);
  const sp = await searchParams;
  const search = (one(sp.search) ?? "").trim().slice(0, 80);

  let cursor: PageCursor | null = null;
  try {
    cursor = decodeCursor(one(sp.cursor) ?? null);
  } catch {
    cursor = null;
  }

  const where: Prisma.DeliveryZoneWhereInput = {
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    AND: [pageWhereName(cursor, "asc") as Prisma.DeliveryZoneWhereInput],
  };

  let rows: DeliveryZone[] | null = null;
  let hasMore = false;
  try {
    const found = await prisma.deliveryZone.findMany({
      where,
      orderBy: pageOrder("name", "asc"),
      take: LIMIT + 1,
    });
    hasMore = found.length > LIMIT;
    rows = hasMore ? found.slice(0, LIMIT) : found;
  } catch {
    rows = null;
  }

  const defaultFee = await getSetting("delivery.default_fee").catch(() => null);
  const scopes=await loadDeliveryScopes((rows ?? []).filter(row=>row.normalizedName.startsWith("scope:")).map(row=>row.id));

  const lastRow = rows && rows.length ? rows[rows.length - 1] : null;
  const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.name, lastRow.id) : null;
  // E-3 closure: the write path needs the store-settings write capability AND
  // the delivery-assignment capability — exactly what the API enforces.
  const canManage =
    admin.permissions.includes("settings.manage") && admin.permissions.includes("delivery.assign");

  return (
    <>
      <PageHead
        eyebrow="الإدارة"
        title="مناطق التوصيل"
        intro="حدد المدينة أو المركز والمنطقة أو القرية ورسومها المعتمدة. عند إعداد نطاق مرتبط بمدينة، تُرفض العناوين خارج النطاقات، والمناطق الموقوفة أو غير المؤهلة. لا توجد مطابقة تخمينية."
      />

      <form
        method="get"
        action="/admin/delivery-zones"
        className="adm-filters"
        aria-label="بحث في مناطق التوصيل"
      >
        <div className="adm-filters-grid">
          <div className="adm-field adm-filter-search">
            <label className="adm-label" htmlFor="zones-search">
              بحث باسم المنطقة
            </label>
            <input
              id="zones-search"
              name="search"
              className="adm-input"
              defaultValue={search}
              maxLength={80}
              placeholder="اسم المنطقة"
              autoComplete="off"
            />
          </div>
          <div className="adm-btn-row">
            <button type="submit" className="adm-btn adm-btn--primary">
              بحث
            </button>
            {search ? (
              <Link href="/admin/delivery-zones" className="adm-btn adm-btn--secondary">
                مسح البحث
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {rows === null ? (
        <ErrorState
          title="مفيش تحميل للقائمة"
          hint="حصلت مشكلة في جلب مناطق التوصيل من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <Panel title="مناطق التوصيل" sub={`${rows.length} منطقة في الصفحة دي`} flush>
          <DataTable
            caption="مناطق التوصيل المسجلة في المتجر"
            columns={[
              { header: "المنطقة" },
              { header: "رسوم التوصيل", numeric: true },
              { header: "الحالة" },
              { header: "التعديل" },
            ]}
            rows={rows.map((zone) => {
              const view: DeliveryZoneView = {
                id: zone.id,
                name: zone.name,
                normalizedName: zone.normalizedName,
                fee: zone.fee.toString(),
                isActive: zone.isActive,
                version: zone.version,
                scope:scopes.get(zone.id) ?? null,
              };
              return [
                <span className="adm-cell-main" key="name">
                  <span className="adm-cell-title">{zone.name}</span>
                  <span>{view.scope ? `${view.scope.city} — ${view.scope.eligible ? "مؤهلة للتوصيل" : "غير مؤهلة للتوصيل"}` : "نطاق قديم غير مرتبط بمدينة"}</span>
                </span>,
                formatMoney(view.fee),
                zone.isActive ? (
                  <Pill key="state" tone="success">
                    مفعّلة
                  </Pill>
                ) : (
                  <Pill key="state" tone="warn">
                    موقوفة
                  </Pill>
                ),
                <div key="actions"><DeliveryZoneActions zone={view} canManage={canManage} /><Link href={`/admin/audit-logs?entityType=delivery_zones&entityId=${zone.id}`}>سجل التعديلات</Link></div>,
              ];
            })}
            emptyLabel="مفيش مناطق توصيل مسجلة."
          />
          <Pager
            basePath="/admin/delivery-zones"
            params={{ search: search || undefined }}
            nextCursor={nextCursor}
            label="منطقة"
          />
        </Panel>
      )}

      <Note tone="info">
        الرسوم الافتراضية دلوقتي: {defaultFee ? formatMoney(defaultFee.valueText) : "مش مهيأة"}. لو مفيش
        منطقة مفعّلة مطابقة لعنوان العميل، المتجر بياخد الرسوم الافتراضية. تقدر تغيّرها من{" "}
        <Link href="/admin/settings" className="adm-cell-title">
          {settingLabel("delivery.default_fee")}
        </Link>
        .
      </Note>

      <Panel title="إضافة منطقة توصيل" sub="الاسم والرسوم، والمنطقة بتبدأ مفعّلة">
        <PermissionGate
          permissions={admin.permissions}
          required="settings.manage"
          alsoRequired={["delivery.assign"]}
          action="إدارة مناطق التوصيل"
        >
          <DeliveryZoneCreateForm />
        </PermissionGate>
      </Panel>
    </>
  );
}
