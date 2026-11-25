import type { DashboardRange } from "./date-range";

export const KPI_CONTRACTS = [
  { id: "orders-total", label: "إجمالي الطلبات", unit: "order", permissions: ["orders.view"], period: "selected", definition: "كل الطلبات المنشأة خلال الفترة، بحسب حالتها الحالية، دون جمع بطاقات الحالات.", source: "orders.created_at; COUNT(*)" },
  { id: "orders-new", label: "الطلبات الجديدة", unit: "order", permissions: ["orders.view"], period: "selected", definition: "طلبات الفترة التي حالتها الحالية NEW.", source: "orders.status = NEW; COUNT(*)" },
  { id: "orders-awaiting", label: "تنتظر التأكيد", unit: "order", permissions: ["orders.view"], period: "selected", definition: "نفس الطلبات الجديدة NEW؛ ليست حالة مستقلة ولا تُجمع معها.", source: "orders.status = NEW; alias of orders-new" },
  { id: "orders-confirmed", label: "الطلبات المؤكدة", unit: "order", permissions: ["orders.view"], period: "selected", definition: "طلبات الفترة التي حالتها الحالية CONFIRMED فقط.", source: "orders.status = CONFIRMED; COUNT(*)" },
  { id: "orders-preparing", label: "جارٍ تجهيزها", unit: "order", permissions: ["orders.view"], period: "selected", definition: "طلبات الفترة التي حالتها الحالية PREPARING فقط.", source: "orders.status = PREPARING; COUNT(*)" },
  { id: "orders-completed", label: "الطلبات المكتملة", unit: "order", permissions: ["orders.view"], period: "selected", definition: "طلبات الفترة المنشأة فيها والتي أصبحت DELIVERED؛ ليس تاريخ التسليم.", source: "orders.status = DELIVERED; COUNT(*)" },
  { id: "orders-cancelled", label: "الطلبات الملغاة", unit: "order", permissions: ["orders.view"], period: "selected", definition: "طلبات الفترة التي حالتها الحالية CANCELLED.", source: "orders.status = CANCELLED; COUNT(*)" },
  { id: "sales-total", label: "إجمالي المبيعات", unit: "EGP", permissions: ["orders.view", "prices.view"], period: "selected", definition: "المبالغ المحصّلة بعد الاستردادات؛ غير متاحة لأن النظام لا يسجل تحصيلًا أو استردادات.", source: "Unavailable: no payment/refund ledger" },
  { id: "order-average", label: "متوسط قيمة الطلب", unit: "EGP", permissions: ["orders.view", "prices.view"], period: "selected", definition: "متوسط total_final للطلبات المكتملة من طلبات الفترة. ليس متوسط المبالغ المحصّلة. لا يُحسب عند غياب إجمالي نهائي لأي طلب مكتمل.", source: "SUM(orders.total_final) / COUNT(DELIVERED); all final totals required" },
  { id: "products-displayed", label: "المنتجات المعروضة", unit: "product", permissions: ["products.view"], period: "current", definition: "منتجات نشطة وغير مؤرشفة الآن؛ عدد المنتجات لا أشكال البيع.", source: "products.is_active = true AND deleted_at IS NULL; COUNT(*)" },
  { id: "products-hidden", label: "المنتجات المخفية", unit: "product", permissions: ["products.view"], period: "current", definition: "منتجات غير نشطة وغير مؤرشفة الآن.", source: "products.is_active = false AND deleted_at IS NULL; COUNT(*)" },
  { id: "products-archived", label: "المنتجات المؤرشفة", unit: "product", permissions: ["products.view"], period: "current", definition: "منتجات لها deleted_at الآن، بصرف النظر عن is_active.", source: "products.deleted_at IS NOT NULL; COUNT(*)" },
  { id: "stock-low", label: "المنتجات منخفضة المخزون", unit: "product", permissions: ["products.view", "inventory.view"], period: "current", definition: "منتجات معروضة بأرصدة مكتملة: يوجد شكل بيع موجب، وكل شكل موجب له حد تنبيه ويقع عنده أو تحته. لا تشمل النافد أو المجهول.", source: "products + active product_variants + inventory; product-level disjoint classification" },
  { id: "stock-out", label: "المنتجات غير المتوفرة", unit: "product", permissions: ["products.view", "inventory.view"], period: "current", definition: "منتجات معروضة لها أشكال بيع نشطة وأرصدة مكتملة، وجميع أرصدتها المتاحة غير موجبة. السجل المفقود ليس صفرًا.", source: "products + active product_variants + inventory; all balances known and <= 0" },
] as const;

export type KpiId = typeof KPI_CONTRACTS[number]["id"];
export type MetricState = "ready" | "denied" | "error" | "unavailable";
export interface DashboardMetric {
  id: KpiId;
  state: MetricState;
  value: number | string | null;
  previous: number | string | null;
  changePercent: number | null;
  note: string | null;
}
export type ReadResult<T> = { state: "ready"; data: T } | { state: "denied" | "error" | "unavailable"; data: null; note: string };
export interface DashboardOrderData {
  byStatus: { status: string; count: number; previous: number }[];
  total: number;
  previousTotal: number;
  daily: { day: string; count: number }[];
  recent: { id: string; orderNumber: string; status: string; createdAt: string }[];
}
export type ProductStockState = "available" | "low" | "out" | "unknown";
export interface DashboardInventoryData {
  total: number;
  available: number;
  low: number;
  out: number;
  unknown: number;
}
export interface DashboardPromotionAlert { id: string; name: string; endAt: string }
export interface DashboardData {
  range: DashboardRange;
  capturedAt: string;
  metrics: DashboardMetric[];
  orders: ReadResult<DashboardOrderData>;
  inventory: ReadResult<DashboardInventoryData>;
  promotions: ReadResult<DashboardPromotionAlert[]>;
}
export interface DashboardStockProduct {
  id: string;
  name: string;
  state: ProductStockState;
  variantCount: number;
  knownCount: number;
}
export interface DashboardStockPage { rows: DashboardStockProduct[]; nextCursor: string | null; invalidCursor: boolean }

const orderStates: Partial<Record<KpiId, string>> = {
  "orders-new": "NEW", "orders-awaiting": "NEW", "orders-confirmed": "CONFIRMED",
  "orders-preparing": "PREPARING", "orders-completed": "DELIVERED", "orders-cancelled": "CANCELLED",
};
export function metricHref(id: KpiId, range: DashboardRange): string | null {
  if (id.startsWith("orders-") || id === "order-average") {
    const params = new URLSearchParams({ dateFrom: range.fromDay, dateTo: range.toDay });
    const status = id === "order-average" ? "DELIVERED" : orderStates[id];
    if (status) params.set("status", status);
    return `/admin/orders?${params}`;
  }
  if (id.startsWith("products-")) return `/admin/products?state=${id.slice(9)}`;
  if (id === "stock-low" || id === "stock-out") return `/admin/inventory/product-status?status=${id === "stock-low" ? "low" : "out"}`;
  return null;
}
