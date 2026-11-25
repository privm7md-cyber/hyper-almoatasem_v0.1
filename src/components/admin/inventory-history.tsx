// Server-rendered, real keyset movement history; no stocktake records invented.
import Link from "next/link";
import { listMovements } from "@/lib/inventory/queries";
import { inventoryUnit, type InventoryDeskFilter } from "@/lib/inventory/overview";
import { movementTypeSchema, referenceTypeSchema } from "@/lib/inventory/validation";
import { formatDateTime, formatQuantity, movementTypeLabel } from "@/lib/admin/terminology";
import { DataTable, ErrorState, Pager, Panel } from "./ui/surfaces";

const SOURCE_LABELS: Record<string, string> = { ORDER: "طلب", PURCHASE: "شراء", RETURN: "مرتجع", ADJUSTMENT: "تسوية", MANUAL: "يدوي" };
export async function InventoryHistory({ filter, basePath, permissions }: {
  filter: InventoryDeskFilter; basePath: string; permissions: string[];
}) {
  const found = await listMovements({
    limit: 20, cursor: filter.cursor ?? null, variantId: filter.variantId ?? null,
    movementType: filter.movementType ?? null, referenceType: filter.referenceType ?? null,
    referenceId: filter.referenceId ?? null, productId: filter.productId,
    categoryId: filter.categoryId, brandId: filter.brandId, productType: filter.type,
    search: filter.search, order: "recent",
  }).catch(() => null);
  return <Panel title="حركة المخزون" sub="الرصيد قبل وبعد كل حركة؛ الوقت بتوقيت القاهرة">
    <form key={JSON.stringify(filter)} method="get" action={basePath} className="adm-filters">
      {Object.entries(filter).filter(([key, value]) => value && !["cursor", "movementType", "referenceType", "referenceId"].includes(key))
        .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      <label className="adm-label">نوع الحركة<select className="adm-select" name="movementType" defaultValue={filter.movementType ?? ""}>
        <option value="">كل الحركات</option>{movementTypeSchema.options.map(type => <option key={type} value={type}>{movementTypeLabel(type)}</option>)}
      </select></label>
      <label className="adm-label">المصدر<select className="adm-select" name="referenceType" defaultValue={filter.referenceType ?? ""}>
        <option value="">كل المصادر</option>{referenceTypeSchema.options.map(type => <option key={type} value={type}>{SOURCE_LABELS[type]}</option>)}
      </select></label>
      <label className="adm-label">المرجع<input className="adm-input" name="referenceId" defaultValue={filter.referenceId} maxLength={64} /></label>
      <button className="adm-btn adm-btn--primary" type="submit">تصفية الحركات</button>
    </form>
    {found === null ? <><ErrorState title="تعذّر تحميل حركة المخزون" hint="راجع الفلاتر. لو مؤشر الصفحة مبقاش صالح، ابدأ السجل من الأول." />
      <Link href={`${basePath}?${new URLSearchParams(Object.entries(filter).filter(([key]) => key !== "cursor"))}`}>ابدأ السجل من الأول</Link></> : <>
      <DataTable caption="حركات المخزون المسجلة" emptyLabel="مفيش حركات مطابقة."
        columns={[{ header: "الصنف" }, { header: "نوع الحركة" }, { header: "الكمية" }, { header: "الوحدة" },
          { header: "الرصيد قبل" }, { header: "الرصيد بعد" }, { header: "السبب" }, { header: "المصدر" },
          { header: "المرجع" }, ...(permissions.includes("users.view") ? [{ header: "المنفّذ" }] : []), { header: "وقت الحركة" }]}
        rows={found.slice(0, 20).map(row => [
          <Link key={row.id} href={`/admin/inventory/${row.productVariantId}`}>{row.variant.product.name} — {row.variant.name}</Link>,
          movementTypeLabel(row.movementType), formatQuantity(row.quantity.toString()),
          inventoryUnit(row.variant.product.productType, row.variant.sizeUnit),
          formatQuantity(row.previousQuantity.toString()), formatQuantity(row.newQuantity.toString()),
          row.reason ?? "—", row.referenceType ? SOURCE_LABELS[row.referenceType] ?? "غير معروف" : "—", row.referenceId ?? "—",
          ...(permissions.includes("users.view") ? [row.createdBy ?? "—"] : []), formatDateTime(row.createdAt),
        ])} />
      <Pager basePath={basePath} params={filter} nextCursor={found.length > 20 ? found[19].id : null} label="حركة" />
    </>}
  </Panel>;
}
