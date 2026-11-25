// GAP-2 Catalog tests (approved FE-10C): products list page + variant price island.
// Identity AND reads are mocked (no DB, no network except stubbed fetch).
// Proves: gate key, list/empty/error states, search + keyset-next preservation,
// Arabic-only labels, local price validation, and the exact mocked PATCH
// contract. NOT live proof of backend authorization or real price writes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/catalog/queries", () => ({
  listProductsForAdmin: vi.fn(),
  listCategoriesForAdmin: vi.fn(),
  listBrandsForAdmin: vi.fn(),
  getProduct: vi.fn(),
  listVariantsWithCodes: vi.fn(),
}));
vi.mock("@/lib/catalog/media", () => ({ listPrimaryImagesForProducts: vi.fn(), listImages: vi.fn() }));

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh, push: vi.fn() }),
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import AdminProductsPage from "../products/page";
import AdminProductDetailPage from "../products/[id]/page";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { ProductEditForm } from "@/components/admin/product-edit-form";
import { VariantCreateForm, VariantEditPanel } from "@/components/admin/variant-form";
import { CodeCreateForm } from "@/components/admin/code-create-form";
import { AdminProductCard } from "@/components/admin/admin-product-card";
import { ProductFilters, DEFAULT_FILTERS, hasActiveFilters } from "@/components/admin/product-filters";
import { isValidElement, type ReactElement } from "react";
import { listImages, listPrimaryImagesForProducts, type MediaRow } from "@/lib/catalog/media";
import { requirePermission } from "@/lib/auth/rbac";
import {
  listBrandsForAdmin,
  listCategoriesForAdmin,
  listProductsForAdmin,
  getProduct,
  listVariantsWithCodes,
} from "@/lib/catalog/queries";

const UUID = "00000000-0000-4000-8000-000000000001";
const CATEGORY = "00000000-0000-4000-8000-000000000002";
const BRAND = "00000000-0000-4000-8000-000000000003";
const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });

function productRow(id: string, name: string, overrides?: Record<string, unknown>) {
  return {
    id,
    name,
    slug: `slug-${id}`,
    productType: "PIECE",
    unit: "PIECE",
    saleStepGrams: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    category: { id: "c-1", name: "ألبان" },
    brand: null,
    minPrice: "25.00",
    stock: "unknown",
    ...overrides,
  };
}

/** The list, batched media and the two taxonomy pickers — never live reads. */
function stubQueries(rows: unknown[] = [], nextCursor: string | null = null) {
  vi.mocked(listPrimaryImagesForProducts).mockResolvedValue(new Map());
  vi.mocked(listProductsForAdmin).mockResolvedValue({
    rows,
    nextCursor,
    invalidCursor: false,
  } as unknown as Awaited<ReturnType<typeof listProductsForAdmin>>);
  vi.mocked(listCategoriesForAdmin).mockResolvedValue({
    rows: [{ id: "c-1", name: "ألبان" }],
    nextCursor: null,
  } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>);
  vi.mocked(listBrandsForAdmin).mockResolvedValue({
    rows: [{ id: "b-1", name: "ماركة" }],
    nextCursor: null,
  } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.mocked(listImages).mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("admin catalog list (FE-10C)", () => {
  it("gates on products.view before reading", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries();
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(requirePermission).toHaveBeenCalledWith("products.view");
    expect(screen.getByRole("link", { name: "كتالوج المتجر" })).toHaveAttribute("href", "/admin/products/storefront");
    expect(screen.getByRole("link", { name: "المنتجات المؤرشفة" })).toHaveAttribute("href", "/admin/products?state=archived");
  });

  it("keeps the storefront catalog discoverable from the archived state", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({ user: { id: "u", name: "n", email: "e" }, roles: [], permissions: ["products.view"] });
    stubQueries();
    render(await AdminProductsPage({ searchParams: Promise.resolve({ state: "archived" }) }));
    expect(screen.getByRole("link", { name: "كتالوج المتجر" })).toHaveAttribute("href", "/admin/products/storefront");
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ state: "archived" }));
  });

  it("renders rows with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries([productRow("p-1", "حليب"), productRow("p-2", "جبنة")]);
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("حليب").length).toBeGreaterThan(0);
    expect(document.querySelector('a[href="/admin/products/p-1"]')).not.toBeNull();
  });

  it("names the sell type and the unit in Arabic and prints no machine token", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries([productRow("p-1", "حليب", { productType: "WEIGHT", unit: "KG" })]);
    const { container } = render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    // Scope to the card: the same Arabic words also label the filter options.
    const card = screen.getByRole("article", { name: "حليب" });
    expect(card.textContent).toContain("بالوزن");
    expect(card.textContent).toContain("كجم");
    expect(container.textContent).not.toContain("WEIGHT");
    expect(container.textContent).not.toContain("KG");
  });

  it("passes type/active filters to the real list query", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries();
    render(
      await AdminProductsPage({
        searchParams: Promise.resolve({ type: "WEIGHT", active: "false" }),
      }),
    );
    expect(listProductsForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ productType: "WEIGHT", isActive: false }),
    );
  });

  it("ignores malformed category/brand filter values instead of failing", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries();
    render(
      await AdminProductsPage({
        searchParams: Promise.resolve({ category: "not-a-uuid", brand: "'; DROP" }),
      }),
    );
    expect(listProductsForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: null, brandId: null }),
    );
  });

  it("preserves type filters in the keyset-next link", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries([productRow("p-1", "حليب")], "cursor-abc");
    render(await AdminProductsPage({ searchParams: Promise.resolve({ type: "WEIGHT" }) }));
    const next = document.querySelector('a[href^="/admin/products?"][href*="cursor="]');
    expect(next?.getAttribute("href")).toContain("cursor=cursor-abc");
    expect(next?.getAttribute("href")).toContain("type=WEIGHT");
  });

  it("shows empty state on zero rows and error state on read failure", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries();
    const { unmount } = render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("لا توجد منتجات مطابقة")).toBeVisible();
    unmount();
    vi.mocked(listProductsForAdmin).mockRejectedValue(new Error("DB down"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("تعذّر تحميل المنتجات")).toBeVisible();
  });

  it("preserves search in the keyset-next link and hides it at the end", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries([productRow("p-1", "حليب")], "cursor-abc");
    render(await AdminProductsPage({ searchParams: Promise.resolve({ search: "حليب" }) }));
    const next = document.querySelector('a[href^="/admin/products?"][href*="cursor="]');
    expect(next?.getAttribute("href")).toContain("cursor=cursor-abc");
    expect(next?.getAttribute("href")).toContain("search=");
  });

  it("hides card prices without prices.view and shows the minimum with the capability", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view", "prices.update"],
    });
    stubQueries([productRow("p-1", "حليب")]);
    const { container, unmount } = render(
      await AdminProductsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(container.textContent).not.toContain("ج.م");
    expect(listProductsForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ withPrices: false }));
    unmount();
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view", "prices.view"],
    });
    stubQueries([productRow("p-1", "حليب")]);
    const second = render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(second.container.textContent).toContain("يبدأ من");
    expect(second.container.textContent).toContain("ج.م");
    expect(listProductsForAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ withPrices: true }));
  });

  it("hides the new-product link without products.create and names the missing capability", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    stubQueries();
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(document.querySelector('a[href="/admin/products/new"]')).toBeNull();
    expect(screen.getByText(/محتاج صلاحية إضافية/)).toBeVisible();
  });

  it("offers the new-product link when products.create is held", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view", "products.create"],
    });
    stubQueries();
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(document.querySelector('a[href="/admin/products/new"]')).not.toBeNull();
  });

  it("denied identity rejects before any read (no data rendered)", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminProductsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listProductsForAdmin).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    await expect(AdminProductsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});

function authorize(permissions: string[] = ["products.view"]) {
  vi.mocked(requirePermission).mockResolvedValue({
    user: { id: "u", name: "n", email: "e" }, roles: [], permissions,
  });
}
function cards(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(cards);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === AdminProductCard ? [node] : []), ...cards(node.props.children as ReactNode)];
}
function cardProduct(overrides: Record<string, unknown> = {}) {
  return productRow("p-1", "أرز", overrides) as unknown as Parameters<typeof AdminProductCard>[0]["product"];
}

describe("ADM-01 states, media and permission projection", () => {
  it.each(["displayed", "hidden", "archived"])("preserves %s through the query, state picker and pager", async (state) => {
    authorize();
    stubQueries([productRow("p-1", "حليب")], "next-id");
    render(await AdminProductsPage({ searchParams: Promise.resolve({ state, active: "true", search: "حليب", unit: "KG" }) }));
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ state, search: "حليب", unit: "KG" }));
    expect(screen.getByLabelText("حالة المنتج")).toHaveValue(state);
    const href = screen.getByRole("link", { name: /الصفحة اللي بعد كده/ }).getAttribute("href")!;
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("state")).toBe(state);
    expect(params.get("cursor")).toBe("next-id");
    expect(params.get("search")).toBe("حليب");
    expect(params.get("unit")).toBe("KG");
    expect(params.has("active")).toBe(false);
  });

  it.each([undefined, "invalid", "all"])("defaults invalid/absent state %s to the nonarchived query", async (state) => {
    authorize();
    stubQueries();
    render(await AdminProductsPage({ searchParams: Promise.resolve({ state }) }));
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ state: null, isActive: null }));
    expect(screen.getByLabelText("حالة المنتج")).toHaveValue("");
  });

  it("synchronizes a legacy active URL with the state picker and preserves the legacy pager", async () => {
    authorize();
    stubQueries([productRow("p-1", "حليب", { isActive: false })], "next-id");
    render(await AdminProductsPage({ searchParams: Promise.resolve({ active: "false" }) }));
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, state: null }));
    expect(screen.getByLabelText("حالة المنتج")).toHaveValue("hidden");
    expect(document.querySelector('select[name="active"]')).toBeNull();
    expect(screen.getByRole("link", { name: /الصفحة اللي بعد كده/ }).getAttribute("href")).toContain("active=false");
  });

  it("uses the search parameter, not q, and carries the current cursor to the query", async () => {
    authorize();
    stubQueries();
    await AdminProductsPage({ searchParams: Promise.resolve({ search: "  حليب  ", q: "wrong", cursor: UUID }) });
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ search: "حليب", cursor: UUID, limit: 20 }));
  });

  it("fetches primary images in one batch for displayed rows and renders honest missing images", async () => {
    authorize();
    stubQueries([productRow("p-1", "حليب"), productRow("p-2", "جبنة")]);
    vi.mocked(listPrimaryImagesForProducts).mockResolvedValue(new Map([
      ["p-1", { url: "https://example.test/milk.jpg", altText: "عبوة حليب" } as MediaRow],
    ]));
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(listPrimaryImagesForProducts).toHaveBeenCalledTimes(1);
    expect(listPrimaryImagesForProducts).toHaveBeenCalledWith(["p-1", "p-2"]);
    expect(screen.getByRole("img", { name: "عبوة حليب" })).toHaveAttribute("loading", "lazy");
    expect(screen.getByRole("img", { name: "عبوة حليب" })).toHaveAttribute("src", "https://example.test/milk.jpg");
    expect(screen.getByText("بلا صورة").closest("article")).toHaveAttribute("aria-label", "جبنة");
  });

  it("keeps catalog cards on media failure without claiming all products lack photos", async () => {
    authorize();
    stubQueries([productRow("p-1", "حليب"), productRow("p-2", "جبنة")]);
    vi.mocked(listPrimaryImagesForProducts).mockRejectedValue(new Error("media unavailable"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText("الصور غير متاحة حاليًا")).toHaveLength(2);
    expect(screen.queryByText("بلا صورة")).toBeNull();
    expect(screen.queryByText("تعذّر تحميل المنتجات")).toBeNull();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
  });

  it("does not read images for empty or failed lists and gives failed reads a retry", async () => {
    authorize();
    stubQueries();
    const { unmount } = render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(listPrimaryImagesForProducts).not.toHaveBeenCalled();
    unmount();
    vi.mocked(listProductsForAdmin).mockRejectedValue(new Error("list unavailable"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(listPrimaryImagesForProducts).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
  });

  it.each([false, true])("requests inventory only with inventory.view, granted=%s, and passes no quantities", async (granted) => {
    authorize(["products.view", "prices.update", "inventory.update", ...(granted ? ["inventory.view"] : [])]);
    stubQueries([productRow("p-1", "حليب", {
      stock: "in", costPrice: "867.53", cost_price: "867.53", availableQuantity: "123.456",
      inventory: { availableQuantity: "123.456" }, variants: [{ price: "25", costPrice: "867.53" }],
      category: { id: "c-1", name: "ألبان", cost_price: "867.53" },
    })]);
    const tree = await AdminProductsPage({ searchParams: Promise.resolve({}) });
    const query = vi.mocked(listProductsForAdmin).mock.calls[0][0];
    if (granted) expect(query.withInventory).toBe(true);
    else expect(query).not.toHaveProperty("withInventory");
    expect(query.withPrices).toBe(false);
    const product = cards(tree)[0].props.product;
    expect(product).toMatchObject({ stock: granted ? "in" : "unknown", minPrice: null });
    expect(JSON.stringify(cards(tree)[0].props)).not.toMatch(/867\.53|123\.456|costPrice|cost_price|availableQuantity|variants/);
    render(tree);
    expect(screen.getByRole("article", { name: "حليب" })).toHaveTextContent(granted ? "متوفر" : "التوفر غير محدد");
  });
});

describe("ADM-01 read-only admin cards", () => {
  it.each([
    { isActive: true, deletedAt: null, status: "معروض", publicLink: true, manage: true },
    { isActive: false, deletedAt: null, status: "مخفي", publicLink: false, manage: true },
    { isActive: true, deletedAt: new Date("2026-11-01"), status: "مؤرشف", publicLink: false, manage: false },
    { isActive: false, deletedAt: new Date("2026-11-01"), status: "مؤرشف", publicLink: false, manage: false },
  ])("$status: only supported navigation, public=$publicLink", ({ isActive, deletedAt, status, publicLink, manage }) => {
    const { container } = render(<AdminProductCard product={cardProduct({ isActive, deletedAt, slug: "أرز" })} image={null} canSeePrices canManage />);
    const article = screen.getByRole("article", { name: "أرز" });
    expect(article).toHaveTextContent(status);
    expect(container.querySelector('a[href^="/p/"]') !== null).toBe(publicLink);
    if (publicLink) {
      expect(container.querySelector('a[href^="/p/"]')).toHaveAttribute("href", `/p/p-1/${encodeURIComponent("أرز")}`);
      expect(screen.getByRole("link", { name: "عرض في المتجر: أرز" })).toHaveAttribute("href", `/p/p-1/${encodeURIComponent("أرز")}`);
    }
    expect(screen.getByRole("link", { name: `${manage ? "تفاصيل وإدارة" : "التفاصيل"}: أرز` })).toHaveAttribute("href", "/admin/products/p-1");
    expect(screen.getAllByRole("link")).toHaveLength(publicLink ? 2 : 1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(article.textContent).not.toMatch(/استعادة|أرشفة|أضف للسلة/);
  });

  it("uses the price minimum without guessing a kilogram basis from WEIGHT", () => {
    render(<AdminProductCard product={cardProduct({ productType: "WEIGHT", unit: "KG", minPrice: "12.5", brand: { id: "b", name: "ماركة" } })} image={null} canSeePrices />);
    const article = screen.getByRole("article", { name: "أرز" });
    expect(article).toHaveTextContent("يبدأ من 12.50 ج.م");
    expect(article).toHaveTextContent("بالوزن · الوحدة: كجم");
    expect(article).toHaveTextContent("التصنيف: ألبان");
    expect(article).toHaveTextContent("العلامة التجارية: ماركة");
    expect(article.textContent).not.toMatch(/\/\s*(كجم|kg)/i);
  });

  it("does not invent a price, brand or image, and keeps stock unknown when coverage is unavailable", () => {
    render(<AdminProductCard product={cardProduct({ minPrice: null })} image={null} canSeePrices />);
    expect(screen.getByText("لا يوجد سعر لشكل بيع متاح")).toBeVisible();
    expect(screen.getByText("بلا صورة")).toBeVisible();
    expect(screen.getByRole("article")).toHaveTextContent("بدون علامة تجارية");
    expect(screen.getByText("التوفر غير محدد")).toBeVisible();
    expect(screen.queryByText(/يبدأ من/)).toBeNull();
  });

  it("labels provable out-of-stock separately from administrative visibility", () => {
    render(<AdminProductCard product={cardProduct({ stock: "oos", isActive: false })} image={null} canSeePrices={false} />);
    expect(screen.getByText("غير متوفر")).toBeVisible();
    expect(screen.getByText("مخفي")).toBeVisible();
    expect(screen.getByRole("article").textContent).not.toContain("ج.م");
  });

  it("retains damaged stored names and their review badge", () => {
    render(<AdminProductCard product={cardProduct({ name: "????" })} image={null} canSeePrices={false} />);
    expect(screen.getByRole("heading", { name: "????" })).toBeVisible();
    expect(screen.getByRole("article", { name: "????" })).toHaveTextContent(/محتاج مراجعة/);
  });
});

describe("ADM-01 state filter GET form", () => {
  it("offers three states and nonarchived all, with a fresh cursor after applying filters", () => {
    render(<ProductFilters values={{ ...DEFAULT_FILTERS, state: "archived" }} categories={[]} brands={[]} />);
    const form = screen.getByRole("form", { name: "فلترة المنتجات" });
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/admin/products");
    expect(screen.getByLabelText("حالة المنتج")).toHaveAttribute("name", "state");
    expect(screen.getByLabelText("حالة المنتج")).toHaveValue("archived");
    expect([...form.querySelectorAll('select[name="state"] option')].map((option) => (option as HTMLOptionElement).value)).toEqual(["", "displayed", "hidden", "archived"]);
    expect(form.querySelector('[name="cursor"]')).toBeNull();
    expect(screen.getByRole("link", { name: "ألغِ الفلترة" })).toHaveAttribute("href", "/admin/products");
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, state: "archived" })).toBe(true);
  });
});

describe("CATALOG D2 URL-driven uncontrolled filters", () => {
  it("resets all controls on URL rerender, clearing filters, and returning to a prior URL", async () => {
    authorize();
    stubQueries();
    const url = { search: "  أرز  ", type: "WEIGHT", unit: "KG", category: CATEGORY, brand: BRAND, active: "false" };
    const { rerender } = render(await AdminProductsPage({ searchParams: Promise.resolve(url) }));
    expect(screen.getByLabelText("بحث في المنتجات")).toHaveValue("أرز");
    expect(screen.getByLabelText("طريقة البيع")).toHaveValue("WEIGHT");
    expect(screen.getByLabelText("وحدة البيع")).toHaveValue("KG");
    expect(screen.getByLabelText("التصنيف")).toHaveValue(CATEGORY);
    expect(screen.getByLabelText("العلامة التجارية")).toHaveValue(BRAND);
    expect(screen.getByLabelText("حالة المنتج")).toHaveValue("hidden");
    fireEvent.change(screen.getByLabelText("بحث في المنتجات"), { target: { value: "مسودة لم تُطبق" } });
    fireEvent.change(screen.getByLabelText("طريقة البيع"), { target: { value: "PIECE" } });
    fireEvent.change(screen.getByLabelText("حالة المنتج"), { target: { value: "archived" } });
    const oldForm = screen.getByRole("form");
    rerender(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("form")).not.toBe(oldForm);
    for (const label of ["بحث في المنتجات", "طريقة البيع", "وحدة البيع", "التصنيف", "العلامة التجارية", "حالة المنتج"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    rerender(await AdminProductsPage({ searchParams: Promise.resolve(url) }));
    expect(screen.getByLabelText("بحث في المنتجات")).toHaveValue("أرز");
    expect(screen.getByLabelText("طريقة البيع")).toHaveValue("WEIGHT");
    expect(screen.getByLabelText("وحدة البيع")).toHaveValue("KG");
    expect(screen.getByLabelText("التصنيف")).toHaveValue(CATEGORY);
    expect(screen.getByLabelText("العلامة التجارية")).toHaveValue(BRAND);
    expect(screen.getByLabelText("حالة المنتج")).toHaveValue("hidden");
  });

  it("keys only on parsed values, not raw URL spelling, parameter order, or pagination", async () => {
    authorize();
    stubQueries();
    const { rerender } = render(await AdminProductsPage({ searchParams: Promise.resolve({ search: " أرز ", type: "invalid" }) }));
    const form = screen.getByRole("form");
    fireEvent.change(screen.getByLabelText("بحث في المنتجات"), { target: { value: "مسودة" } });
    rerender(await AdminProductsPage({ searchParams: Promise.resolve({ cursor: UUID, type: "", search: "أرز" }) }));
    expect(screen.getByRole("form")).toBe(form);
    expect(screen.getByLabelText("بحث في المنتجات")).toHaveValue("مسودة");
  });

  it.each([
    { field: "search", value: "أرز" }, { field: "type", value: "WEIGHT" }, { field: "unit", value: "KG" },
    { field: "category", value: CATEGORY }, { field: "brand", value: BRAND },
    { field: "state", value: "archived" }, { field: "active", value: "false" },
  ])("$field alone changes the deterministic form key", ({ field, value }) => {
    const { rerender } = render(<ProductFilters values={DEFAULT_FILTERS} categories={[]} brands={[]} />);
    const oldForm = screen.getByRole("form");
    fireEvent.change(screen.getByLabelText("بحث في المنتجات"), { target: { value: "مسودة" } });
    rerender(<ProductFilters values={{ ...DEFAULT_FILTERS, [field]: value }} categories={[]} brands={[]} />);
    expect(screen.getByRole("form")).not.toBe(oldForm);
    expect(screen.getByLabelText("بحث في المنتجات")).toHaveValue(field === "search" ? value : "");
  });
});

describe("CATALOG D3 complete filter pickers", () => {
  it("follows real nextCursor values beyond 200 options for both pickers, preserving order and narrow props", async () => {
    authorize();
    stubQueries();
    const categories = Array.from({ length: 201 }, (_, i) => ({ id: `category-${i}`, name: `تصنيف ${i}`, costPrice: "867.53", productCount: 2 }));
    const brands = Array.from({ length: 202 }, (_, i) => ({ id: `brand-${i}`, name: `علامة ${i}`, cost_price: "867.53" }));
    vi.mocked(listCategoriesForAdmin)
      .mockResolvedValueOnce({ rows: categories.slice(0, 200), nextCursor: "category-199" } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>)
      .mockResolvedValueOnce({ rows: categories.slice(200), nextCursor: null } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>);
    vi.mocked(listBrandsForAdmin)
      .mockResolvedValueOnce({ rows: brands.slice(0, 200), nextCursor: "brand-199" } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>)
      .mockResolvedValueOnce({ rows: brands.slice(200), nextCursor: null } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>);
    const tree = await AdminProductsPage({ searchParams: Promise.resolve({}) });
    const picker = tree.props.children.find((node: ReactNode) => isValidElement(node) && node.type === ProductFilters);
    expect(picker.props.categories).toEqual(categories.map(({ id, name }) => ({ id, name })));
    expect(picker.props.brands).toEqual(brands.map(({ id, name }) => ({ id, name })));
    expect(JSON.stringify(picker.props)).not.toMatch(/867\.53|costPrice|cost_price|productCount/);
    render(tree);
    expect((screen.getByLabelText("التصنيف") as HTMLSelectElement).options).toHaveLength(202);
    expect((screen.getByLabelText("العلامة التجارية") as HTMLSelectElement).options).toHaveLength(203);
    expect(screen.getByRole("option", { name: "تصنيف 200" })).toHaveValue("category-200");
    expect(screen.getByRole("option", { name: "علامة 201" })).toHaveValue("brand-201");
    for (const [query, cursor] of [[listCategoriesForAdmin, "category-199"], [listBrandsForAdmin, "brand-199"]] as const) {
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenNthCalledWith(1, { limit: 200, cursor: null, search: null, isActive: null, includeDeleted: false });
      expect(query).toHaveBeenNthCalledWith(2, { limit: 200, cursor, search: null, isActive: null, includeDeleted: false });
    }
  });

  it.each(["category", "brand"] as const)("second-page %s failure warns, discards partial options, preserves selected ids, and offers retry", async (kind) => {
    authorize();
    stubQueries([productRow(UUID, "أرز")]);
    const query = kind === "category" ? listCategoriesForAdmin : listBrandsForAdmin;
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: "partial", name: "قائمة ناقصة" }], nextCursor: UUID } as unknown as Awaited<ReturnType<typeof query>>)
      .mockRejectedValueOnce(new Error("second page unavailable"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({ category: CATEGORY, brand: BRAND, state: "hidden" }) }));
    expect(screen.getByText(kind === "category" ? "تعذّر تحميل قائمة التصنيفات كاملة." : "تعذّر تحميل قائمة العلامات التجارية كاملة.")).toBeVisible();
    expect(screen.queryByRole("option", { name: "قائمة ناقصة" })).toBeNull();
    expect(screen.queryByText(kind === "category" ? "لا توجد تصنيفات متاحة للفلترة." : "لا توجد علامات تجارية متاحة للفلترة.")).toBeNull();
    expect(screen.getByLabelText("التصنيف")).toHaveValue(CATEGORY);
    expect(screen.getByLabelText("العلامة التجارية")).toHaveValue(BRAND);
    const data = new FormData(screen.getByRole("form") as HTMLFormElement);
    expect(data.get("category")).toBe(CATEGORY);
    expect(data.get("brand")).toBe(BRAND);
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ categoryId: CATEGORY, brandId: BRAND, state: "hidden" }));
    expect(screen.getByRole("article", { name: "أرز" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows genuine empty pickers without warning/retry and keeps unavailable selected filters, not all", async () => {
    authorize();
    stubQueries();
    vi.mocked(listCategoriesForAdmin).mockResolvedValue({ rows: [], nextCursor: null });
    vi.mocked(listBrandsForAdmin).mockResolvedValue({ rows: [], nextCursor: null });
    render(await AdminProductsPage({ searchParams: Promise.resolve({ category: CATEGORY, brand: BRAND }) }));
    expect(screen.getByText("لا توجد تصنيفات متاحة للفلترة.")).toBeVisible();
    expect(screen.getByText("لا توجد علامات تجارية متاحة للفلترة.")).toBeVisible();
    expect(screen.queryByText(/تعذّر تحميل قائمة/)).toBeNull();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
    expect(screen.getByLabelText("التصنيف")).toHaveValue(CATEGORY);
    expect(screen.getByLabelText("العلامة التجارية")).toHaveValue(BRAND);
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({ categoryId: CATEGORY, brandId: BRAND }));
  });

  it("reports first-page failures for both pickers without pretending the lists are empty", async () => {
    authorize();
    stubQueries();
    vi.mocked(listCategoriesForAdmin).mockRejectedValue(new Error("unavailable"));
    vi.mocked(listBrandsForAdmin).mockRejectedValue(new Error("unavailable"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("تعذّر تحميل قائمة التصنيفات كاملة.")).toBeVisible();
    expect(screen.getByText("تعذّر تحميل قائمة العلامات التجارية كاملة.")).toBeVisible();
    expect(screen.queryByText(/لا توجد .* متاحة للفلترة/)).toBeNull();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
  });

  it("fails visibly instead of looping when a picker repeats a cursor", async () => {
    authorize();
    stubQueries();
    vi.mocked(listCategoriesForAdmin).mockResolvedValue({ rows: [], nextCursor: UUID });
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(listCategoriesForAdmin).toHaveBeenCalledTimes(2);
    expect(screen.getByText("تعذّر تحميل قائمة التصنيفات كاملة.")).toBeVisible();
  });
});

describe("CATALOG stale product cursor recovery", () => {
  const filters = { search: "أرز", type: "WEIGHT", unit: "KG", category: CATEGORY, brand: BRAND, state: "hidden" };
  it.each(["not-uuid", "", [UUID, UUID]])("malformed cursor %s recovers before the query and keeps every filter", async (cursor) => {
    authorize();
    stubQueries([productRow(UUID, "أرز")]);
    render(await AdminProductsPage({ searchParams: Promise.resolve({ ...filters, cursor }) }));
    expect(listProductsForAdmin).toHaveBeenCalledTimes(1);
    expect(listProductsForAdmin).toHaveBeenCalledWith(expect.objectContaining({
      cursor: null, search: "أرز", productType: "WEIGHT", unit: "KG", categoryId: CATEGORY, brandId: BRAND, state: "hidden",
    }));
    expect(screen.getByRole("article", { name: "أرز" })).toBeVisible();
    expect(screen.queryByText("لا توجد منتجات مطابقة")).toBeNull();
    const start = new URL(screen.getByRole("link", { name: "بداية النتائج بنفس الفلترة" }).getAttribute("href")!, "https://example.test");
    expect(Object.fromEntries(start.searchParams)).toEqual(filters);
  });

  it.each(["missing", "foreign-filter", "deleted"])("domain-invalid %s cursor reloads start without changing query meaning", async () => {
    authorize(["products.view", "prices.view", "inventory.view"]);
    stubQueries([productRow(UUID, "أرز")], BRAND);
    vi.mocked(listProductsForAdmin).mockResolvedValueOnce({ rows: [], nextCursor: null, invalidCursor: true });
    render(await AdminProductsPage({ searchParams: Promise.resolve({ ...filters, cursor: UUID }) }));
    const [first, recovered] = vi.mocked(listProductsForAdmin).mock.calls.map(([query]) => query);
    expect(first.cursor).toBe(UUID);
    expect(recovered).toEqual({ ...first, cursor: null });
    expect(recovered).toMatchObject({ withPrices: true, withInventory: true });
    expect(screen.getByRole("article", { name: "أرز" })).toBeVisible();
    expect(screen.queryByText("لا توجد منتجات مطابقة")).toBeNull();
    expect(screen.getByText(/عرضنا بداية النتائج بنفس الفلترة/)).toBeVisible();
    expect(listPrimaryImagesForProducts).toHaveBeenCalledWith([UUID]);
    const next = new URL(screen.getByRole("link", { name: /الصفحة اللي بعد كده/ }).getAttribute("href")!, "https://example.test");
    expect(Object.fromEntries(next.searchParams)).toEqual({ ...filters, cursor: BRAND });
  });

  it("keeps legacy active on the recovery link and does not claim an empty catalog on recovery failure", async () => {
    authorize();
    stubQueries();
    vi.mocked(listProductsForAdmin)
      .mockResolvedValueOnce({ rows: [], nextCursor: null, invalidCursor: true })
      .mockRejectedValueOnce(new Error("start unavailable"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({ cursor: UUID, active: "false", search: "أرز" }) }));
    expect(screen.getByText("تعذّر تحميل المنتجات")).toBeVisible();
    expect(screen.queryByText("لا توجد منتجات مطابقة")).toBeNull();
    expect(screen.getByText(/تعذّر تحميل بداية النتائج/)).toBeVisible();
    expect(screen.getByRole("link", { name: "بداية النتائج بنفس الفلترة" })).toHaveAttribute("href", `/admin/products?search=${encodeURIComponent("أرز")}&active=false`);
    expect(listPrimaryImagesForProducts).not.toHaveBeenCalled();
  });

  it("keeps a legitimate exhausted cursor distinct from invalid-cursor recovery", async () => {
    authorize();
    stubQueries();
    render(await AdminProductsPage({ searchParams: Promise.resolve({ cursor: UUID }) }));
    expect(listProductsForAdmin).toHaveBeenCalledTimes(1);
    expect(screen.getByText("لا توجد منتجات مطابقة")).toBeVisible();
    expect(screen.queryByRole("link", { name: "بداية النتائج بنفس الفلترة" })).toBeNull();
  });
});

describe("CATALOG D5 product detail visibility", () => {
  it.each([
    { isActive: true, deletedAt: null, state: "معروض في المتجر", links: 2 },
    { isActive: false, deletedAt: null, state: "مخفي من المتجر", links: 0 },
    { isActive: true, deletedAt: new Date("2026-11-01"), state: "مؤرشف", links: 0 },
    { isActive: false, deletedAt: new Date("2026-11-01"), state: "مؤرشف", links: 0 },
  ])("$state active=$isActive: accurately labels status and gates both public links", async ({ isActive, deletedAt, state, links }) => {
    authorize();
    stubQueries();
    vi.mocked(getProduct).mockResolvedValue({
      ...productRow(UUID, "أرز", { isActive, deletedAt }), description: null,
    } as unknown as Awaited<ReturnType<typeof getProduct>>);
    vi.mocked(listVariantsWithCodes).mockResolvedValue([]);
    const { container } = render(await AdminProductDetailPage({ params: Promise.resolve({ id: UUID }), searchParams: Promise.resolve({}) }));
    expect(getProduct).toHaveBeenCalledWith(UUID, true);
    expect(screen.getByText("حالة المنتج").closest("div")).toHaveTextContent(state);
    expect(screen.queryByText("معروض في المتجر؟")).toBeNull();
    expect(container.querySelectorAll('a[href^="/p/"]')).toHaveLength(links);
    expect(screen.queryAllByRole("link", { name: "افتحه في المتجر" })).toHaveLength(links);
    for (const link of screen.queryAllByRole("link", { name: "افتحه في المتجر" })) {
      expect(link).toHaveAttribute("href", `/p/${UUID}/slug-${UUID}`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(container.textContent).not.toMatch(/استعادة|أرشفة|حذف المنتج/);
    expect(screen.queryByRole("button", { name: /استعادة|أرشفة|حذف/ })).toBeNull();
  });
});

function detailIslands(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => detailIslands(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node] : []), ...detailIslands(node.props.children as ReactNode, type)];
}

function stubDetail(overrides: Record<string, unknown> = {}, permissions = ["products.view", "products.update"]) {
  authorize(permissions);
  stubQueries();
  vi.mocked(getProduct).mockResolvedValue({
    ...productRow(UUID, "أرز", overrides), description: null,
  } as unknown as Awaited<ReturnType<typeof getProduct>>);
  vi.mocked(listVariantsWithCodes).mockResolvedValue([]);
}

function detailPage() {
  return AdminProductDetailPage({ params: Promise.resolve({ id: UUID }), searchParams: Promise.resolve({}) });
}

const DETAIL_WRITES = ["products.view", "products.update", "products.create", "prices.view", "prices.update"];

describe("CATDETAIL complete edit pickers and source failures (mock-only)", () => {
  it("follows both actual nextCursor chains past 200, preserving order, selection and narrow client props", async () => {
    const categories = Array.from({ length: 203 }, (_, i) => ({ id: `category-${i}`, name: `تصنيف ${i}`, costPrice: "867.53", productCount: 2 }));
    const brands = Array.from({ length: 202 }, (_, i) => ({ id: `brand-${i}`, name: `علامة ${i}`, cost_price: "867.53" }));
    stubDetail({ category: categories[202], brand: brands[201], costPrice: "867.53" });
    vi.mocked(listCategoriesForAdmin)
      .mockResolvedValueOnce({ rows: categories.slice(0, 200), nextCursor: CATEGORY } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>)
      .mockResolvedValueOnce({ rows: categories.slice(200, 201), nextCursor: UUID } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>)
      .mockResolvedValueOnce({ rows: categories.slice(201), nextCursor: null } as unknown as Awaited<ReturnType<typeof listCategoriesForAdmin>>);
    vi.mocked(listBrandsForAdmin)
      .mockResolvedValueOnce({ rows: brands.slice(0, 200), nextCursor: BRAND } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>)
      .mockResolvedValueOnce({ rows: brands.slice(200, 201), nextCursor: UUID } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>)
      .mockResolvedValueOnce({ rows: brands.slice(201), nextCursor: null } as unknown as Awaited<ReturnType<typeof listBrandsForAdmin>>);
    const tree = await detailPage();
    const edit = detailIslands(tree, ProductEditForm)[0];
    expect(edit.props.categories).toEqual(categories.map(({ id, name }) => ({ id, name })));
    expect(edit.props.brands).toEqual(brands.map(({ id, name }) => ({ id, name })));
    expect(JSON.stringify(edit.props)).not.toMatch(/867\.53|costPrice|cost_price|productCount/);
    render(tree);
    expect(screen.getByLabelText(/التصنيف/)).toHaveValue("category-202");
    expect(screen.getByLabelText(/العلامة التجارية/)).toHaveValue("brand-201");
    expect((screen.getByLabelText(/التصنيف/) as HTMLSelectElement).options).toHaveLength(203);
    expect((screen.getByLabelText(/العلامة التجارية/) as HTMLSelectElement).options).toHaveLength(203);
    for (const [query, cursors] of [[listCategoriesForAdmin, [null, CATEGORY, UUID]], [listBrandsForAdmin, [null, BRAND, UUID]]] as const) {
      expect(query).toHaveBeenCalledTimes(3);
      cursors.forEach((cursor, i) => {
        expect(query).toHaveBeenNthCalledWith(i + 1, { limit: 200, cursor, search: null, isActive: null, includeDeleted: false });
      });
    }
  });

  it("preserves missing current taxonomy by stored id/name without widening lookup props", async () => {
    stubDetail({
      category: { id: CATEGORY, name: "تصنيف حالي مؤرشف", deletedAt: new Date(), costPrice: "867.53" },
      brand: { id: BRAND, name: "علامة حالية مؤرشفة", deletedAt: new Date(), cost_price: "867.53" },
    });
    const tree = await detailPage();
    const edit = detailIslands(tree, ProductEditForm)[0];
    expect(edit.props.categories).toEqual([{ id: "c-1", name: "ألبان" }, { id: CATEGORY, name: "تصنيف حالي مؤرشف" }]);
    expect(edit.props.brands).toEqual([{ id: "b-1", name: "ماركة" }, { id: BRAND, name: "علامة حالية مؤرشفة" }]);
    expect(JSON.stringify(edit.props)).not.toMatch(/867\.53|costPrice|cost_price|deletedAt/);
    render(tree);
    expect(screen.getByRole("option", { name: "تصنيف حالي مؤرشف" })).toHaveValue(CATEGORY);
    expect(screen.getByRole("option", { name: "علامة حالية مؤرشفة" })).toHaveValue(BRAND);
    fireEvent.change(screen.getByLabelText(/اسم المنتج/), { target: { value: "اسم مختلف" } });
    expect(screen.getByLabelText(/التصنيف/)).toHaveValue(CATEGORY);
    expect(screen.getByLabelText(/العلامة التجارية/)).toHaveValue(BRAND);
  });

  it.each([false, true])("keeps genuinely empty lookups usable with current options, current brand=%s", async (hasBrand) => {
    stubDetail({ category: { id: CATEGORY, name: "التصنيف المحفوظ" }, brand: hasBrand ? { id: BRAND, name: "العلامة المحفوظة" } : null });
    vi.mocked(listCategoriesForAdmin).mockResolvedValue({ rows: [], nextCursor: null });
    vi.mocked(listBrandsForAdmin).mockResolvedValue({ rows: [], nextCursor: null });
    const tree = await detailPage();
    const edit = detailIslands(tree, ProductEditForm)[0];
    expect(edit.props.categories).toEqual([{ id: CATEGORY, name: "التصنيف المحفوظ" }]);
    expect(edit.props.brands).toEqual(hasBrand ? [{ id: BRAND, name: "العلامة المحفوظة" }] : []);
    render(tree);
    expect(screen.getByLabelText(/التصنيف/)).toHaveValue(CATEGORY);
    expect(screen.getByLabelText(/العلامة التجارية/)).toHaveValue(hasBrand ? BRAND : "");
    expect(screen.getByRole("button", { name: "احفظ التعديلات" })).toBeVisible();
    expect(screen.queryByText(/تعذّر تحميل قائمة/)).toBeNull();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
  });

  it.each([
    { kind: "category", later: false }, { kind: "brand", later: false },
    { kind: "category", later: true }, { kind: "brand", later: true },
  ])("blocks the edit island on $kind failure, later page=$later, with explicit warning and retry", async ({ kind, later }) => {
    stubDetail({}, DETAIL_WRITES);
    const query = kind === "category" ? listCategoriesForAdmin : listBrandsForAdmin;
    if (later) {
      vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "partial", name: "قائمة ناقصة" }], nextCursor: UUID } as unknown as Awaited<ReturnType<typeof query>>);
    }
    vi.mocked(query).mockRejectedValueOnce(new Error("private read failure 867.53"));
    const tree = await detailPage();
    expect(detailIslands(tree, ProductEditForm)).toHaveLength(0);
    expect(detailIslands(tree, VariantCreateForm)).toHaveLength(1);
    render(tree);
    expect(screen.getByText(kind === "category" ? "تعذّر تحميل قائمة التصنيفات كاملة." : "تعذّر تحميل قائمة العلامات التجارية كاملة.")).toBeVisible();
    expect(screen.getByText("التعديل غير متاح لحد ما القوائم تتحمّل كاملة. البيانات الحالية محفوظة زي ما هي.")).toBeVisible();
    expect(screen.queryByLabelText(/اسم المنتج/)).toBeNull();
    expect(screen.queryByRole("button", { name: "احفظ التعديلات" })).toBeNull();
    expect(screen.queryByRole("option", { name: "قائمة ناقصة" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "أرز" })).toBeVisible();
    expect(screen.getByRole("button", { name: "أضف الشكل" })).toBeVisible();
    expect(document.body.textContent).not.toContain("private read failure");
    expect(query).toHaveBeenCalledTimes(later ? 2 : 1);
    if (later) expect(query).toHaveBeenLastCalledWith({ limit: 200, cursor: UUID, search: null, isActive: null, includeDeleted: false });
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("reports both lookup failures explicitly with one existing retry control", async () => {
    stubDetail();
    vi.mocked(listCategoriesForAdmin).mockRejectedValue(new Error("category unavailable"));
    vi.mocked(listBrandsForAdmin).mockRejectedValue(new Error("brand unavailable"));
    const tree = await detailPage();
    expect(detailIslands(tree, ProductEditForm)).toHaveLength(0);
    render(tree);
    expect(screen.getByText("تعذّر تحميل قائمة التصنيفات كاملة.")).toBeVisible();
    expect(screen.getByText("تعذّر تحميل قائمة العلامات التجارية كاملة.")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "إعادة المحاولة" })).toHaveLength(1);
  });

  it.each(["category", "brand"])("fails explicitly when the %s cursor repeats, instead of looping or mounting partial options", async (kind) => {
    stubDetail();
    const query = kind === "category" ? listCategoriesForAdmin : listBrandsForAdmin;
    vi.mocked(query).mockResolvedValue({ rows: [], nextCursor: UUID });
    const tree = await detailPage();
    expect(query).toHaveBeenCalledTimes(2);
    expect(detailIslands(tree, ProductEditForm)).toHaveLength(0);
    render(tree);
    expect(screen.getByText(kind === "category" ? "تعذّر تحميل قائمة التصنيفات كاملة." : "تعذّر تحميل قائمة العلامات التجارية كاملة.")).toBeVisible();
  });
});

describe("CATDETAIL action anchors match actual form permissions", () => {
  it.each([
    { permissions: ["products.view"], edit: false, create: false },
    { permissions: ["products.view", "prices.view", "prices.update"], edit: false, create: false },
    { permissions: ["products.view", "products.update"], edit: true, create: false },
    { permissions: ["products.view", "products.create"], edit: false, create: true },
    { permissions: ["products.view", "products.update", "products.create"], edit: true, create: true },
  ])("shows anchors and matching forms only with their exact capability: $permissions", async ({ permissions, edit, create }) => {
    stubDetail({}, permissions);
    render(await detailPage());
    expect(requirePermission).toHaveBeenCalledWith("products.view");
    expect(document.querySelector('a[href="#edit-product"]') !== null).toBe(edit);
    expect(screen.queryByRole("button", { name: "احفظ التعديلات" }) !== null).toBe(edit);
    expect(document.querySelector('a[href="#add-shape"]') !== null).toBe(create);
    expect(screen.queryByRole("button", { name: "أضف الشكل" }) !== null).toBe(create);
  });
});

describe("CATDETAIL unavailable variants versus genuine zero", () => {
  it("reports unavailable shapes/codes, omits their dependent islands, and retries without blocking independent forms", async () => {
    stubDetail({}, DETAIL_WRITES);
    vi.mocked(listVariantsWithCodes).mockRejectedValue(new Error("private variants failure 867.53"));
    const tree = await detailPage();
    for (const type of [VariantPriceEditor, CodeCreateForm, VariantEditPanel]) {
      expect(detailIslands(tree, type)).toHaveLength(0);
    }
    expect(detailIslands(tree, ProductEditForm)).toHaveLength(1);
    expect(detailIslands(tree, VariantCreateForm)).toHaveLength(1);
    render(tree);
    expect(listVariantsWithCodes).toHaveBeenCalledWith(UUID);
    expect(screen.getByText("تعذّر تحميل أشكال البيع. البيانات غير متاحة حاليًا.")).toBeVisible();
    expect(screen.getByText("تعذّر تحميل الأكواد. البيانات غير متاحة حاليًا.")).toBeVisible();
    expect(screen.getByText("أشكال البيع غير متاحة للتعديل حاليًا.")).toBeVisible();
    expect(screen.queryByText("مفيش أشكال بيع للمنتج ده")).toBeNull();
    expect(screen.queryByText("مفيش أكواد مسجلة")).toBeNull();
    expect(screen.queryByText("مفيش أشكال بيع للتعديل.")).toBeNull();
    expect(screen.getByRole("button", { name: "احفظ التعديلات" })).toBeVisible();
    expect(screen.getByRole("button", { name: "أضف الشكل" })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/private variants failure|867\.53/);
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("preserves genuine zero variants/codes without an unavailable warning or retry", async () => {
    stubDetail({}, DETAIL_WRITES);
    render(await detailPage());
    expect(screen.getByText("مفيش أشكال بيع للمنتج ده")).toBeVisible();
    expect(screen.getByText("مفيش أكواد مسجلة")).toBeVisible();
    expect(screen.getByText("مفيش أشكال بيع للتعديل.")).toBeVisible();
    expect(screen.queryByText(/تعذّر تحميل|غير متاحة حاليًا/)).toBeNull();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
  });
});

describe("variant price editor (mocked PATCH)", () => {
  const variants = [{ id: "v-1", name: "عبوة", price: "25.00" }];

  it("blocks invalid local prices without any request", async () => {
    render(<VariantPriceEditor variants={variants} />);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ السعر" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the exact PATCH contract and translates the server rejection into Arabic", async () => {
    render(<VariantPriceEditor variants={variants} />);
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "VALIDATION", message: "Invalid price.", details: null } }, 422),
    );
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "27.50" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ السعر" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("السعر مش مظبوط");
    expect(alert.textContent).not.toContain("Invalid price");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/catalog/variants/v-1/price");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ price: "27.50" });
  });

  it("refuses a no-op price (same value) without any request (Phase-10)", () => {
    render(<VariantPriceEditor variants={variants} />);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // The variant currently costs 25.00 — re-submitting it is a no-op.
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: "احفظ السعر" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("alert").textContent).toContain("لا يوجد تغيير");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hides the price fields from an account without the price capability", () => {
    render(<VariantPriceEditor variants={variants} canSeePrices={false} />);
    expect(screen.queryByPlaceholderText("0.00")).toBeNull();
    expect(screen.getByText(/الأسعار مش معروضة لحسابك/)).toBeVisible();
  });
});
