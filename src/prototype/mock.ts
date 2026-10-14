// INTERACTIVE PROTOTYPE — MOCK DATA ONLY. No backend, no DB, no fetch.
// Every price/stock/total below is hard-coded scenario fiction for UX review.
// Nothing here is authoritative and nothing here authorizes a purchase.

export type SaleUnit = "PIECE" | "KG" | "GRAM";

export interface MockProduct {
  id: string;
  name: string;
  unit: SaleUnit;
  price: string; // display-only mock decimal string
  compareAt: string | null; // mock reference only, NOT an offer proof
  stock: "in" | "oos" | "inactive";
  categoryId: string;
  brand: string | null;
  saleStepGrams: number | null;
  presetsGrams: number[] | null;
  promoBadge: string | null; // mock badge text (scenario fiction)
}

export interface MockCategory {
  id: string;
  name: string;
}

export interface CartLine {
  productId: string;
  qtyText: string; // packs for PIECE, grams for WEIGHT (display mock)
}

export type OrderStatus =
  | "NEW"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export interface MockReplacement {
  id: string;
  originalName: string;
  substituteName: string;
  substitutePrice: string;
  status: "PROPOSED" | "CUSTOMER_APPROVED" | "CUSTOMER_REJECTED";
}

export interface MockOrder {
  id: string;
  number: string;
  status: OrderStatus;
  lines: { name: string; qty: string; price: string }[];
  total: string;
  requestedVsActual: { name: string; requested: string; actual: string | null }[];
  replacement: MockReplacement | null;
}

export const CATEGORIES: MockCategory[] = [
  { id: "c-dairy", name: "الألبان والأجبان" },
  { id: "c-pantry", name: "البقالة" },
  { id: "c-empty", name: "قسم تجريبي فارغ" },
];

export const PRODUCTS: MockProduct[] = [
  {
    id: "p-rice",
    name: "أرز بسمتي فاخر — كيس 5 كجم",
    unit: "PIECE",
    price: "320.00",
    compareAt: "360.00",
    stock: "in",
    categoryId: "c-pantry",
    brand: "المعتصم",
    saleStepGrams: null,
    presetsGrams: null,
    promoBadge: "خصم تجريبي 40 ج.م",
  },
  {
    id: "p-romi",
    name: "جبنة رومي قديمة",
    unit: "KG",
    price: "320.00",
    compareAt: null,
    stock: "in",
    categoryId: "c-dairy",
    brand: null,
    saleStepGrams: 250,
    presetsGrams: [125, 250, 500, 1000, 1250],
    promoBadge: null,
  },
  {
    id: "p-sugar",
    name: "سكر أبيض — كيس 1 كجم",
    unit: "PIECE",
    price: "42.00",
    compareAt: null,
    stock: "oos",
    categoryId: "c-pantry",
    brand: null,
    saleStepGrams: null,
    presetsGrams: null,
    promoBadge: null,
  },
];

export function getProduct(id: string): MockProduct | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getCategory(id: string): MockCategory | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export const INITIAL_ORDER: MockOrder = {
  id: "o-demo-1",
  number: "HM-000123",
  status: "PREPARING",
  lines: [
    { name: "جبنة رومي قديمة", qty: "1250 جم", price: "400.00" },
    { name: "أرز بسمتي فاخر — كيس 5 كجم", qty: "1 عبوة", price: "320.00" },
  ],
  total: "720.00",
  requestedVsActual: [
    { name: "جبنة رومي قديمة", requested: "1250 جم", actual: "1180 جم" },
  ],
  replacement: {
    id: "r-demo-1",
    originalName: "سكر أبيض — كيس 1 كجم",
    substituteName: "سكر أبيض بديل — كيس 1 كجم",
    substitutePrice: "44.00",
    status: "PROPOSED",
  },
};

export interface AdminProductRow {
  id: string;
  name: string;
  unit: SaleUnit;
  price: string;
  stock: string;
}

export const ADMIN_PRODUCTS: AdminProductRow[] = [
  { id: "p-rice", name: "أرز بسمتي فاخر — كيس 5 كجم", unit: "PIECE", price: "320.00", stock: "متوفر: 500" },
  { id: "p-romi", name: "جبنة رومي قديمة", unit: "KG", price: "320.00 / كجم", stock: "متوفر: 42.500 كجم" },
  { id: "p-sugar", name: "سكر أبيض — كيس 1 كجم", unit: "PIECE", price: "42.00", stock: "غير متوفر" },
];

export const SCENARIOS: { href: string; label: string }[] = [
  { href: "/prototype", label: "1 · شراء ناجح (المسار الكامل)" },
  { href: "/prototype/product/p-sugar", label: "2 · منتج غير متوفر" },
  { href: "/prototype/product/p-rice", label: "3 · منتج بالقطعة" },
  { href: "/prototype/product/p-romi", label: "4 · منتج بالوزن" },
  { href: "/prototype/product/p-rice", label: "5 · عرض ترويجي (شارة تجريبية)" },
  { href: "/prototype/cart", label: "6 · سلة فارغة (بعد مسح السلة)" },
  { href: "/prototype/checkout", label: "7/8 · تحقق الحقول + خطأ تجريبي" },
  { href: "/prototype", label: "9 · تحميل (زر المعاينة بالرئيسية)" },
  { href: "/prototype/orders/o-demo-1", label: "10 · طلب غير نهائي + 11 · بديل" },
  { href: "/prototype/orders/o-demo-1", label: "12 · بديل مرفوض (زر الرفض)" },
  { href: "/prototype/admin/login", label: "13/14 · دخول إدارة ناجح/فاشل" },
  { href: "/prototype/admin/catalog", label: "15 · كتالوج (زر عرض الفارغ)" },
  { href: "/prototype/admin/orders/o-demo-1", label: "16 · إجراء غير مسموح (زر محاكاة 403)" },
];
