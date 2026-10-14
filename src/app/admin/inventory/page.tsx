// FE-10D inventory page (server): reads + movements + adjust/threshold islands.
// Reads: inventory.view. Writes: inventory.adjust (adjust + threshold PATCH).

import { requirePermission } from "@/lib/auth/rbac";
import Link from "next/link";
import { listInventory, listMovements } from "@/lib/inventory/queries";
import { toInventory, toMovement } from "@/lib/inventory/serialize";
import { AdminSection, AdminTable } from "@/components/admin/admin-table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { InventoryAdjustForm, InventoryThresholdForm } from "@/components/admin/inventory-forms";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "المخزون — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; inStock?: string; lowStock?: string; cursor?: string }>;
}) {
  await requirePermission("inventory.view");
  const sp = await searchParams;
  const search = typeof sp.search === "string" && sp.search.trim() !== "" ? sp.search.trim().slice(0, 120) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  const inStock = sp.inStock === "true" ? true : sp.inStock === "false" ? false : null;
  const lowStock = sp.lowStock === "true" ? true : null;
  // Raw filter strings, preserved verbatim into the next-page URL (no re-encoding loss).
  const rawInStock = sp.inStock === "true" || sp.inStock === "false" ? sp.inStock : null;
  const rawLowStock = sp.lowStock === "true" ? "true" : null;
  let rows: ReturnType<typeof toInventory>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listInventory({ limit: 20, cursor, search, productId: null, inStock, lowStock });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20).map((r) =>
      toInventory({
        productVariantId: r.productVariantId,
        quantity: r.quantity,
        reservedQuantity: r.reservedQuantity,
        availableQuantity: r.availableQuantity,
        lowStockThreshold: r.lowStockThreshold,
        updatedAt: r.updatedAt,
      }),
    );
  } catch {
    rows = null;
  }
  const movements = await listMovements({ limit: 10, cursor: null, variantId: null, movementType: null, referenceType: null, referenceId: null }).catch(() => null);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">المخزون</h1>
      <form method="get" action="/admin/inventory" className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="inv-search">بحث المخزون</label>
        <input id="inv-search" name="search" defaultValue={search ?? ""} placeholder="بحث باسم المنتج…" maxLength={120} className="min-h-[44px] flex-1 rounded-control border border-line bg-white px-3" />
        <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">بحث</button>
      </form>
      <AdminSection title="الأرصدة (الكمية / المحجوز / المتاح)">
        {rows === null ? (
          <ErrorState title="تعذّر تحميل المخزون" text="حاول إعادة تحميل الصفحة." />
        ) : rows.length === 0 ? (
          <EmptyState title="لا توجد صفوف مطابقة" hint="جرّب بحثًا مختلفًا." />
        ) : (
          <AdminTable
            caption="صفوف المخزون"
            headers={["Variant", "الكمية", "المحجوز", "المتاح", "الحالة"]}
            rows={rows.map((r) => [
              <span key={`v-${r.productVariantId}`} className="font-mono text-xs" dir="ltr">{r.productVariantId.slice(0, 8)}…</span>,
              <bdi key={`q-${r.productVariantId}`}>{r.quantity}</bdi>,
              <bdi key={`r-${r.productVariantId}`}>{r.reservedQuantity}</bdi>,
              <bdi key={`a-${r.productVariantId}`}>{r.availableQuantity}</bdi>,
              <span key={`s-${r.productVariantId}`}>{r.stockStatus}</span>,
            ])}
          />
        )}
        {rows !== null && rows.length > 0 && next ? (
          <p>
            <Link
              href={`/admin/inventory?${new URLSearchParams({
                ...(search ? { search } : {}),
                ...(rawInStock ? { inStock: rawInStock } : {}),
                ...(rawLowStock ? { lowStock: rawLowStock } : {}),
                cursor: next,
              }).toString()}`}
              className="font-semibold text-brand"
            >
              الصفحة التالية
            </Link>
          </p>
        ) : null}
      </AdminSection>
      <AdminSection title="تعديل يدوي (inventory.adjust)">
        <InventoryAdjustForm />
      </AdminSection>
      <AdminSection title="حد المخزون المنخفض (inventory.adjust)">
        <InventoryThresholdForm />
      </AdminSection>
      <AdminSection title="أحدث الحركات">
        {!movements || movements.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد حركات مسجلة.</p>
        ) : (
          <AdminTable
            caption="حركات المخزون"
            headers={["النوع", "الكمية", "السابق", "الجديد", "السبب"]}
            rows={movements.slice(0, 10).map((m) => {
              const s = toMovement(m);
              return [
                <span key={`t-${s.id}`}>{s.movementType}</span>,
                <bdi key={`q-${s.id}`}>{s.quantity}</bdi>,
                <bdi key={`p-${s.id}`}>{s.previousQuantity}</bdi>,
                <bdi key={`n-${s.id}`}>{s.newQuantity}</bdi>,
                <span key={`r-${s.id}`}>{s.reason ?? "—"}</span>,
              ];
            })}
          />
        )}
      </AdminSection>
    </main>
  );
}
