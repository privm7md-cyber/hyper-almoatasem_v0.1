import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { getInventoryOverview, listInventoryVariants, parseInventoryDesk, inventoryUnit, variantBalanceState, inventoryFormOptions,
  type InventoryDeskFilter } from "@/lib/inventory/overview";
import { PermissionGate } from "@/components/admin/permission-gate";
import { InventoryAddStockForm, InventoryAdjustForm, InventoryThresholdForm } from "@/components/admin/inventory-forms";
import { InventoryHistory } from "@/components/admin/inventory-history";
import { DataTable, ErrorState, Note, Panel, PageHead, Pager, Pill, StatCard } from "@/components/admin/ui/surfaces";
import { formatQuantity, stockStatusLabel } from "@/lib/admin/terminology";

export const dynamic = "force-dynamic";
export const metadata = { title: "المخزون — لوحة إدارة هايبر المعتصم", robots: { index: false, follow: false } };
const TABS = [
  ["", "كل الأصناف"], ["balances", "الأرصدة المعروفة"], ["low_stock", "منخفض"],
  ["out_of_stock", "رصيد متاح صفر"], ["missing", "رصيد مفقود / غير متاح"], ["history", "الحركات"],
] as const;

export default async function AdminInventoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePermission("inventory.view");
  const raw = await searchParams;
  let filter: InventoryDeskFilter;
  try { filter = parseInventoryDesk(raw); } catch {
    return <><PageHead title="المخزون" /><ErrorState title="تعذّر تحميل المخزون" hint="فلتر أو مؤشر صفحة غير صالح. ابدأ من الأول وراجع الفلاتر." />
      <Link href="/admin/inventory">ابدأ من الأول</Link></>;
  }
  const [overview, found] = await Promise.all([
    getInventoryOverview(filter).catch(() => null),
    filter.status === "history" ? null : listInventoryVariants(filter).catch(() => null),
  ]);
  const rows = found?.slice(0, 20) ?? [];
  const options = inventoryFormOptions(rows);
  const restart = { ...filter }; delete restart.cursor;
  return <>
    <PageHead eyebrow="المخزون" title="المخزون" intro="مراجعة كل أشكال البيع، حتى اللي ملهاش رصيد مسجّل. الأرقام أعداد أصناف، وليست مجموع كميات بوحدات مختلفة." actions={admin.permissions.includes("inventory.adjust") ? <Link href="/admin/inventory/import" className="adm-btn adm-btn--secondary">استيراد مخزون الكاشير</Link> : undefined} />
    <Note tone="warn">سجل جرد دائم ودورة مطابقة واعتماد للجرد غير مدعومين في النظام الحالي. المتاح هو تسوية كمية معدودة لصنف برصيد معروف، بسبب وتأكيد صريح. الرصيد المفقود لا يُنشأ تلقائيًا.</Note>
    {overview ? <div className="adm-stats">
      <StatCard label="كل أشكال البيع" value={overview.total} />
      <StatCard label="أصناف برصيد معروف" value={overview.known} />
      <StatCard label="متاح موجب عند حد التنبيه أو أقل" value={overview.low} />
      <StatCard label="أصناف برصيد متاح صفر" value={overview.zero} />
      <StatCard label="رصيد مفقود أو غير معروف" value={overview.missing} />
    </div> : <ErrorState title="تعذّر تحميل أعداد المخزون" />}
    <nav aria-label="أقسام المخزون" className="adm-btn-row">
      {TABS.map(([status, label]) => <Link key={status} aria-current={(filter.status ?? "") === status ? "page" : undefined}
        className="adm-btn adm-btn--ghost" href={`/admin/inventory?${new URLSearchParams({ ...restart, status })}`}>{label}</Link>)}
    </nav>
    <form key={JSON.stringify(restart)} method="get" action="/admin/inventory" className="adm-filters">
      <label className="adm-label">بحث<input className="adm-input" type="search" name="search" defaultValue={filter.search} maxLength={120} placeholder="اسم المنتج أو الشكل أو الباركود" /></label>
      <label className="adm-label">الحالة<select className="adm-select" name="status" defaultValue={filter.status ?? ""}>
        {TABS.map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        <option value="in_stock">متوفر أعلى من حد التنبيه</option>
      </select></label>
      <label className="adm-label">نوع البيع<select className="adm-select" name="type" defaultValue={filter.type ?? ""}>
        <option value="">كل الأنواع</option><option value="PIECE">بالقطعة</option><option value="WEIGHT">بالوزن</option>
      </select></label>
      {([["categoryId", "معرّف التصنيف"], ["brandId", "معرّف العلامة"], ["productId", "معرّف المنتج"], ["variantId", "معرّف الشكل"]] as const)
        .map(([key, label]) => <label key={key} className="adm-label">{label}<input className="adm-input" name={key} defaultValue={filter[key]} dir="ltr" /></label>)}
      {(["movementType", "referenceType", "referenceId"] as const).map(key => filter[key] ? <input key={key} type="hidden" name={key} value={filter[key]} /> : null)}
      <button type="submit" className="adm-btn adm-btn--primary">بحث</button>
      <Link href="/admin/inventory" className="adm-btn adm-btn--ghost">مسح الفلتر</Link>
    </form>
    {filter.status === "history" ? await InventoryHistory({ filter, basePath: "/admin/inventory", permissions: admin.permissions }) : <>
      <Panel title="مراجعة الرصيد" sub="المسجّل والمحجوز والمتاح بنفس وحدة الصنف">
        <Note tone="info">العملية دي بتعرض الرصيد بس، من غير ما تغيّر أي كمية. افتح تفاصيل الشكل لمراجعة الباركود وآخر تحديث وسجل الحركات.</Note>
        {found === null ? <><ErrorState title="تعذّر تحميل المخزون" hint="القراءة فشلت أو مؤشر الصفحة مبقاش مطابق. ابدأ من الأول بنفس الفلاتر." />
          <Link href={`/admin/inventory?${new URLSearchParams(restart)}`}>ابدأ من الأول بنفس الفلاتر</Link></> : <>
          <DataTable caption="أرصدة المخزون لكل صنف في المتجر" emptyLabel="مفيش أصناف مطابقة للفلتر ده."
            columns={[
              { header: "المنتج" },
              { header: "الوحدة" },
              { header: "الكمية المسجّلة", numeric: true },
              { header: "المحجوز", numeric: true },
              { header: "المتاحة", numeric: true },
              { header: "حد التنبيه", numeric: true },
              { header: "الحالة" },
            ]}
            rows={rows.map(row => {
              const state = variantBalanceState(row);
              const inventory = row.inventory;
              return [<span key={row.id} className="adm-cell-main"><span className="adm-cell-title">
                {admin.permissions.includes("products.view") ? <Link href={`/admin/products/${row.product.id}`}>{row.product.name}</Link> : row.product.name}
              </span><Link href={`/admin/inventory/${row.id}`}>{row.name}</Link><span className="adm-cell-id">{row.id}</span></span>,
              inventoryUnit(row.product.productType, row.sizeUnit), formatQuantity(inventory?.quantity.toString()),
              formatQuantity(inventory?.reservedQuantity.toString()), formatQuantity(inventory?.availableQuantity?.toString()),
              formatQuantity(inventory?.lowStockThreshold?.toString()),
              <Pill key={`s-${row.id}`} tone={state === "missing" ? "neutral" : state === "low_stock" ? "warn" : state === "out_of_stock" ? "danger" : "success"}>
                {state === "missing" ? "الرصيد غير معروف" : stockStatusLabel(state)}</Pill>];
            })} />
          <Pager basePath="/admin/inventory" params={restart} nextCursor={found.length > 20 ? found[19].id : null} label="صنف" />
        </>}
      </Panel>
      <Panel title="إضافة كمية" sub="زيادة رصيد معروف لصنف واحد">
        <Note tone="accent">العملية دي بتزوّد الكمية المسجّلة، وتسجّل حركة وسببها. مش بتنشئ رصيد مفقود.</Note>
        <PermissionGate permissions={admin.permissions} required="inventory.adjust" action="إضافة كمية للمخزون"><InventoryAddStockForm variants={options} /></PermissionGate>
      </Panel>
      <Panel title="تسوية الكمية" sub="فرق المعدود عن المسجّل">
        <Note tone="warn">العملية دي بتضبط الرصيد على الكمية اللي اتقادت. لو الرصيد اتغيّر، العملية تترفض وتراجع الرصيد الأول.</Note>
        <PermissionGate permissions={admin.permissions} required="inventory.adjust" action="تسوية كمية المخزون"><InventoryAdjustForm variants={options} /></PermissionGate>
      </Panel>
      <Panel title="حد التنبيه" sub="تنبيه على المتاح الموجب">
        <Note tone="info">العملية دي بتحدد الرقم اللي من عنده الصنف يحتاج مراجعة؛ مش بتغيّر الكمية.</Note>
        <PermissionGate permissions={admin.permissions} required="inventory.adjust" action="تعديل حد التنبيه"><InventoryThresholdForm variants={options} /></PermissionGate>
      </Panel>
    </>}
  </>;
}
