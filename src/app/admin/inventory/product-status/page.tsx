import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listDashboardStockProducts } from "@/lib/admin/dashboard";
import type { DashboardStockPage, ProductStockState } from "@/lib/admin/dashboard-contract";
import { DataTable, EmptyState, ErrorState, Note, PageHead, Pager, Panel } from "@/components/admin/ui/surfaces";
import { AdminRetryButton } from "@/components/admin/ui/controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "حالة مخزون المنتجات — الإدارة", robots: { index: false, follow: false } };
const LABELS: Record<ProductStockState, string> = { available: "متوفرة", low: "منخفضة المخزون", out: "غير متوفرة", unknown: "توافرها غير معروف" };

export default async function ProductStockPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inventory.view");
  await requirePermission("products.view");
  const params = await props.searchParams;
  const validStatus = params.status === undefined || (typeof params.status === "string" && Object.hasOwn(LABELS, params.status));
  const status = validStatus && typeof params.status === "string" ? params.status as ProductStockState : "low";
  const malformedCursor = params.cursor !== undefined && typeof params.cursor !== "string";
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  let page: DashboardStockPage | null = null;
  if (validStatus && !malformedCursor) page = await listDashboardStockProducts(status, cursor, 20).catch(() => null);
  const startHref = `/admin/inventory/product-status?status=${status}`;
  return (
    <>
      <PageHead eyebrow="المخزون" title={`منتجات ${LABELS[status]}`} intro="حالة المنتجات المعروضة الآن، محسوبة من أشكال البيع النشطة وأرصدة مخزونها؛ ليست حالة الطلبات خلال الفترة." actions={<AdminRetryButton />} />
      <form key={status} method="get" action="/admin/inventory/product-status" className="adm-filters">
        <div className="adm-field">
          <label className="adm-label" htmlFor="product-stock-status">حالة مخزون المنتج</label>
          <select id="product-stock-status" name="status" className="adm-select" defaultValue={status}>
            {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="submit" className="adm-btn adm-btn--primary">عرض المنتجات</button>
      </form>
      {!validStatus ? <ErrorState title="فلتر حالة المخزون غير صالح" hint={<Link href={startHref}>اختر حالة صحيحة</Link>} /> : malformedCursor || page?.invalidCursor ? (
        <ErrorState title="رابط الصفحة لم يعد متاحًا" hint={<Link href={startHref}>بداية المنتجات بنفس الحالة</Link>} />
      ) : page === null ? (
        <ErrorState title="البيانات غير متاحة حاليًا" hint="تعذّر قراءة أرصدة المنتجات؛ لا يعني ذلك أن المخزون صفر." />
      ) : page.rows.length === 0 ? (
        <EmptyState title={cursor ? "وصلت لنهاية المنتجات المطابقة" : "لا توجد منتجات مطابقة لهذه الحالة"} hint="التصنيف يعتمد على بيانات المخزون المعروفة فقط." action={<Link href={startHref}>بداية المنتجات بنفس الحالة</Link>} />
      ) : (
        <Panel title="المنتجات المطابقة" sub="منتج واحد لكل سطر، وليس شكل بيع واحدًا" flush>
          <DataTable caption={`المنتجات ${LABELS[status]}`} columns={[{ header: "المنتج" }, { header: "الحالة" }, { header: "أشكال البيع النشطة", numeric: true }, { header: "الأرصدة المعروفة", numeric: true }]} rows={page.rows.map(row => [
            <Link key={row.id} className="adm-cell-title" href={`/admin/products/${row.id}`}>{row.name}</Link>, LABELS[row.state], row.variantCount, row.knownCount,
          ])} />
          <Pager basePath="/admin/inventory/product-status" params={{ status }} nextCursor={page.nextCursor} label="منتج" />
        </Panel>
      )}
      <Note tone="info">المنتج النافد يتطلب أرصدة مكتملة لجميع أشكال بيعه. رصيد مفقود أو غير معروف لا يُحسب صفرًا. انخفاض المخزون لا يشمل المنتجات النافدة، والحدود تُطبّق على كل شكل بيع دون جمع وحدات مختلفة.</Note>
    </>
  );
}
