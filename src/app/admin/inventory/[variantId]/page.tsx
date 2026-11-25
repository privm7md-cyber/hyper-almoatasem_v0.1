import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/api/validation";
import { getInventoryVariant, parseInventoryDesk, inventoryFormOptions, inventoryUnit, variantBalanceState } from "@/lib/inventory/overview";
import { PermissionGate } from "@/components/admin/permission-gate";
import { InventoryAddStockForm, InventoryAdjustForm, InventoryThresholdForm } from "@/components/admin/inventory-forms";
import { InventoryHistory } from "@/components/admin/inventory-history";
import { ErrorState, KeyValue, Note, PageHead, Panel } from "@/components/admin/ui/surfaces";
import { codeTypeLabel, formatDateTime, formatQuantity, productTypeLabel, sizeUnitLabel, stockStatusLabel } from "@/lib/admin/terminology";

export const dynamic = "force-dynamic";
export const metadata = { title: "تفاصيل مخزون الصنف", robots: { index: false, follow: false } };

export default async function InventoryVariantPage({ params, searchParams }: {
  params: Promise<{ variantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requirePermission("inventory.view"); // before params and reads
  const { variantId } = await params;
  if (!uuidSchema.safeParse(variantId).success) notFound();
  const basePath = `/admin/inventory/${variantId}`;
  let filter;
  try { filter = { ...parseInventoryDesk(await searchParams), variantId }; } catch {
    return <><ErrorState title="فلتر أو مؤشر سجل غير صالح" /><Link href={basePath}>ابدأ من الأول</Link></>;
  }
  const row = await getInventoryVariant(variantId).catch(() => undefined);
  if (row === undefined) return <ErrorState title="تعذّر تحميل تفاصيل المخزون" hint="فشل قراءة البيانات؛ جرّب تحديث الصفحة." />;
  if (!row) notFound();
  const inventory = row.inventory;
  const state = variantBalanceState(row);
  const unit = inventoryUnit(row.product.productType, row.sizeUnit);
  const options = inventoryFormOptions([row]);
  const sellable = row.isActive && row.deletedAt === null && row.product.isActive && row.product.deletedAt === null;
  return <>
    <PageHead eyebrow="المخزون" title={`${row.product.name} — ${row.name}`} intro="بيانات الصنف ورصيده وسجل حركاته؛ من غير أسعار أو تكلفة." actions={<Link href="/admin/inventory" className="adm-btn adm-btn--secondary">كل المخزون</Link>} />
    <Panel title="بيانات الصنف">
      <KeyValue items={[
        { label: "المنتج", value: admin.permissions.includes("products.view") ? <Link href={`/admin/products/${row.product.id}`}>{row.product.name}</Link> : row.product.name },
        { label: "شكل البيع", value: row.name }, { label: "معرّف الشكل", value: row.id },
        { label: "نوع البيع", value: productTypeLabel(row.product.productType) },
        { label: "وحدة الرصيد الفعلية", value: unit },
        { label: "مقاس العبوة / أساس الوزن", value: row.sizeValue === null ? "غير مسجّل" : `${formatQuantity(row.sizeValue.toString())} ${sizeUnitLabel(row.sizeUnit ?? "")}` },
        { label: "التصنيف", value: row.product.category.name }, { label: "العلامة", value: row.product.brand?.name ?? "غير مسجّلة" },
        { label: "إتاحة شكل البيع", value: sellable ? "نشط" : "غير متاح للبيع" },
        { label: "الباركود والأكواد", value: row.codes.length ? row.codes.map(code => `${codeTypeLabel(code.type)}: ${code.code}`).join(" · ") : "مفيش أكواد مسجّلة" },
      ]} />
      <Note tone="info">بالقطعة: الرصيد بعدد العبوات، مش بحجم محتواها. بالوزن: الوحدة حسب أساس الشكل (جم، وإلا كجم) كما يستخدمها نظام المخزون.</Note>
    </Panel>
    <Panel title="الرصيد الحالي">
      <KeyValue items={[
        { label: "حالة الرصيد", value: state === "missing" ? "الرصيد مفقود أو غير معروف" : stockStatusLabel(state) },
        { label: "المسجّل", value: inventory ? `${formatQuantity(inventory.quantity.toString())} ${unit}` : "غير معروف" },
        { label: "المحجوز", value: inventory ? `${formatQuantity(inventory.reservedQuantity.toString())} ${unit}` : "غير معروف" },
        { label: "المتاح", value: inventory?.availableQuantity == null ? "غير معروف" : `${formatQuantity(inventory.availableQuantity.toString())} ${unit}` },
        { label: "حد التنبيه", value: inventory?.lowStockThreshold == null ? "غير محدد" : `${formatQuantity(inventory.lowStockThreshold.toString())} ${unit}` },
        { label: "آخر تحديث", value: inventory ? formatDateTime(inventory.updatedAt) : "لا يوجد رصيد مسجّل" },
      ]} />
    </Panel>
    <Note tone="warn">دورة جرد ومطابقة واعتماد دائمة غير مدعومة. يمكن تسجيل فرق كمية معدودة لرصيد معروف فقط؛ لا ننشئ رصيدًا افتتاحيًا أو سجلات جرد افتراضية.</Note>
    {options.length ? <PermissionGate permissions={admin.permissions} required="inventory.adjust" action="تعديل كميات المخزون">
      <Panel title="إضافة كمية"><InventoryAddStockForm variants={options} /></Panel>
      <Panel title="تسوية الكمية"><InventoryAdjustForm variants={options} /></Panel>
      <Panel title="حد التنبيه"><InventoryThresholdForm variants={options} /></Panel>
    </PermissionGate> : <Note tone="info">لا يمكن تعديل رصيد غير معروف. لا توجد عملية إنشاء رصيد تلقائية في هذه الصفحة.</Note>}
    {await InventoryHistory({ filter, basePath, permissions: admin.permissions })}
  </>;
}
