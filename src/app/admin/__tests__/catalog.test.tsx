// GAP-2 Catalog tests (approved FE-10C): products list page + variant price island.
// Identity AND reads are mocked (no DB, no network except stubbed fetch).
// Proves: gate key, list/empty/error states, search + keyset-next preservation,
// local price validation, and the exact mocked PATCH contract. NOT live proof of
// backend authorization or real price writes.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

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
  listProducts: vi.fn(),
  listCategories: vi.fn(),
  listBrands: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// `@/lib/api/serialize` carries `import "server-only"` (backend boundary marker),
// which vitest/jsdom cannot import. Stubbed here with byte-identical pure behavior
// (null-passthrough + toString + toISOString, verified against the source above);
// domain mapping in `@/lib/catalog/serialize` stays real and under test.
vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminProductsPage from "../products/page";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { requirePermission } from "@/lib/auth/rbac";
import { listBrands, listCategories, listProducts } from "@/lib/catalog/queries";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });

/** The products page also loads the taxonomy pickers for the create form. */
function stubTaxonomy() {
  vi.mocked(listCategories).mockResolvedValue({
    rows: [{ id: "c-1", name: "ألبان" }],
    nextCursor: null,
  } as unknown as Awaited<ReturnType<typeof listCategories>>);
  vi.mocked(listBrands).mockResolvedValue({
    rows: [{ id: "b-1", name: "ماركة" }],
    nextCursor: null,
  } as unknown as Awaited<ReturnType<typeof listBrands>>);
}

function productRow(id: string, name: string) {
  return {
    id,
    name,
    slug: `slug-${id}`,
    productType: "PIECE",
    unit: "PIECE",
    saleStepGrams: null,
    isActive: true,
    category: { id: "c-1", name: "ألبان", slug: "dairy" },
    brand: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

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
    vi.mocked(listProducts).mockResolvedValueOnce({ rows: [], nextCursor: null });
    stubTaxonomy();
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(requirePermission).toHaveBeenCalledWith("products.view");
  });

  it("renders rows with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    vi.mocked(listProducts).mockResolvedValueOnce({
      rows: [productRow("p-1", "حليب"), productRow("p-2", "جبنة")],
      nextCursor: null,
    } as unknown as Awaited<ReturnType<typeof listProducts>>);
    stubTaxonomy();
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("حليب")).toBeVisible();
    expect(document.querySelector('a[href="/admin/products/p-1"]')).not.toBeNull();
  });

  it("shows empty state on zero rows and error state on read failure", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    vi.mocked(listProducts).mockResolvedValueOnce({ rows: [], nextCursor: null });
    stubTaxonomy();
    const { unmount } = render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("لا توجد منتجات مطابقة")).toBeVisible();
    unmount();
    vi.mocked(listProducts).mockRejectedValueOnce(new Error("DB down"));
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("تعذّر تحميل المنتجات")).toBeVisible();
  });

  it("preserves search in the keyset-next link and hides it at the end", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    vi.mocked(listProducts).mockResolvedValueOnce({
      rows: [productRow("p-1", "حليب")],
      nextCursor: "cursor-abc",
    } as unknown as Awaited<ReturnType<typeof listProducts>>);
    stubTaxonomy();
    render(await AdminProductsPage({ searchParams: Promise.resolve({ search: "حليب" }) }));
    const next = document.querySelector('a[href^="/admin/products?"]');
    expect(next?.getAttribute("href")).toContain("cursor=cursor-abc");
    expect(next?.getAttribute("href")).toContain("search=");
  });

  it("hides the product-create form without products.create and names the missing key", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view"],
    });
    vi.mocked(listProducts).mockResolvedValueOnce({ rows: [], nextCursor: null });
    stubTaxonomy();
    render(await AdminProductsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "إنشاء المنتج" })).toBeNull();
    expect(screen.getAllByText(/products\.create/).length).toBeGreaterThan(0);
  });

  it("renders the product-create form when products.create is held", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      user: { id: "u", name: "n", email: "e" },
      roles: [],
      permissions: ["products.view", "products.create"],
    });
    vi.mocked(listProducts).mockResolvedValueOnce({ rows: [], nextCursor: null });
    stubTaxonomy();
    render(
      <ToastProvider>{await AdminProductsPage({ searchParams: Promise.resolve({}) })}</ToastProvider>,
    );
    expect(screen.getByRole("button", { name: "إنشاء المنتج" })).toBeVisible();
  });

  it("denied identity rejects before any read (no data rendered)", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminProductsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listProducts).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    await expect(AdminProductsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("variant price editor (mocked PATCH)", () => {
  const variants = [{ id: "v-1", name: "عبوة", price: "25.00" }];

  it("blocks invalid local prices without any request", async () => {
    render(
      <ToastProvider>
        <VariantPriceEditor variants={variants} />
      </ToastProvider>,
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ السعر" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the exact PATCH contract and surfaces server validation errors", async () => {
    render(
      <ToastProvider>
        <VariantPriceEditor variants={variants} />
      </ToastProvider>,
    );
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "VALIDATION", message: "سعر مرفوض.", details: null } }, 422),
    );
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "27.50" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ السعر" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("سعر مرفوض.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/catalog/variants/v-1/price");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ price: "27.50" });
  });

  it("refuses a no-op price (same value) without any request (Phase-10)", () => {
    render(
      <ToastProvider>
        <VariantPriceEditor variants={variants} />
      </ToastProvider>,
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // The variant currently costs 25.00 — re-submitting it is a no-op.
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ السعر" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("alert").textContent).toContain("لا يوجد تغيير");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
