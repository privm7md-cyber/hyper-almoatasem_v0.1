// Isolated server page composition: real serializers, mocked identity/reads.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
const m = vi.hoisted(() => ({ permission: vi.fn(), product: vi.fn(), variants: vi.fn(), categories: vi.fn(), brands: vi.fn(), images: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/catalog/queries", () => ({ getProduct: m.product, listVariantsWithCodes: m.variants, listCategoriesForAdmin: m.categories, listBrandsForAdmin: m.brands }));
vi.mock("@/lib/catalog/media", () => ({ listImages: m.images }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
import Page from "../products/[id]/page";
import { ProductImageManager } from "@/components/admin/product-image-manager";
import { ProductLifecycleControls } from "@/components/admin/product-lifecycle-controls";
import { VariantEditPanel } from "@/components/admin/variant-form";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { CodeCreateForm } from "@/components/admin/code-create-form";
const TOKEN = "2026-11-12T10:00:00.000Z";
const ID = "00000000-0000-4000-8000-000000000001";
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node] : []), ...find(node.props.children as ReactNode, type)];
}
function page() { return Page({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) }); }
function auth(permissions: string[]) { m.permission.mockResolvedValue({ user: { id: "admin", email: "private", name: "private" }, roles: [], permissions }); }

beforeEach(() => {
  vi.resetAllMocks(); auth(["products.view", "products.update", "products.delete"]);
  m.product.mockResolvedValue({ id: ID, name: "أرز", slug: "rice", description: null, productType: "PIECE", unit: "PIECE", saleStepGrams: null, isActive: true, deletedAt: null,
    category: { id: "cat", name: "التصنيف" }, brand: null, createdAt: new Date(TOKEN), updatedAt: new Date(TOKEN), costPrice: "867.53" });
  m.variants.mockResolvedValue([{ id: "variant-1", productId: ID, name: "عبوة", sizeValue: null, sizeUnit: null, price: "741.23", compareAtPrice: "742.99", costPrice: "867.53", isActive: true, codes: [] }]);
  m.categories.mockResolvedValue({ rows: [{ id: "cat", name: "التصنيف" }], nextCursor: null });
  m.brands.mockResolvedValue({ rows: [], nextCursor: null }); m.images.mockResolvedValue([]);
});
afterEach(cleanup);

describe("product detail lifecycle and gallery composition", () => {
  it("guards products.view before any product, variant, gallery or taxonomy read", async () => {
    m.permission.mockRejectedValue(new Error("denied")); await expect(page()).rejects.toThrow("denied");
    for (const fn of [m.product, m.variants, m.images, m.categories, m.brands]) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    { permissions: ["products.view"], archive: false, restore: false, lifecycle: false, delete: false },
    { permissions: ["products.view", "products.update"], archive: false, restore: true, lifecycle: true, delete: false },
    { permissions: ["products.view", "products.delete"], archive: true, restore: false, lifecycle: true, delete: true },
  ])("projects exact lifecycle and media capabilities: $permissions", async ({ permissions, archive, restore, lifecycle, delete: canDelete }) => {
    auth(permissions); const tree = await page();
    expect(m.permission).toHaveBeenCalledWith("products.view"); expect(m.images).toHaveBeenCalledWith(ID);
    const controls = find(tree, ProductLifecycleControls); expect(controls).toHaveLength(lifecycle ? 1 : 0);
    if (lifecycle) expect(controls[0].props).toEqual({ productId: ID, productName: "أرز", archived: false, expectedUpdatedAt: TOKEN, canArchive: archive, canRestore: restore, canDelete });
    expect(find(tree, ProductImageManager)[0].props).toEqual({ productId: ID, images: [], canUpdate: restore, canDelete: archive });
  });
  it("archived product has restore controls and points to the existing archive listing", async () => {
    const row = await m.product(); m.product.mockResolvedValue({ ...row, deletedAt: new Date(TOKEN), isActive: false });
    const tree = await page(); expect(find(tree, ProductLifecycleControls)[0].props.archived).toBe(true);
    render(tree); expect(screen.getByRole("link", { name: "المنتجات المؤرشفة" })).toHaveAttribute("href", "/admin/products?state=archived");
    expect(screen.getByRole("button", { name: "استعادة المنتج كمخفي" })).toBeVisible(); expect(screen.queryByRole("link", { name: "افتحه في المتجر" })).toBeNull();
  });
  it("gallery failure differs from empty and omits dependent gallery forms", async () => {
    m.images.mockRejectedValue(new Error("private media failure")); const tree = await page();
    expect(find(tree, ProductImageManager)).toHaveLength(0); render(tree);
    expect(screen.getByText(/تعذّر تحميل صور المنتج/)).toBeVisible(); expect(screen.queryByText("مفيش صور مسجلة للمنتج ده.")).toBeNull();
    expect(screen.getByRole("button", { name: "أرشفة المنتج" })).toBeVisible(); expect(document.body.textContent).not.toContain("private media failure");
  });
  it("genuine empty gallery is not a failure", async () => {
    auth(["products.view"]); render(await page()); expect(screen.getByText("مفيش صور مسجلة للمنتج ده.")).toBeVisible(); expect(screen.queryByText(/تعذّر تحميل صور المنتج/)).toBeNull();
  });
  it("only serialized media metadata reaches the image island", async () => {
    m.images.mockResolvedValue([{ id: "image-1", productId: ID, url: "https://example.test/photo.png", altText: null, mimeType: "image/png", byteSize: 30, width: 10, height: 10, sortOrder: 1, isPrimary: false, createdAt: new Date(TOKEN), secret: "not-client-safe" }]);
    const gallery = find(await page(), ProductImageManager)[0];
    expect(gallery.props.images).toEqual([{ id: "image-1", url: "https://example.test/photo.png", altText: null, mimeType: "image/png", byteSize: 30, width: 10, height: 10, sortOrder: 1, isPrimary: false, createdAt: TOKEN }]);
    expect(JSON.stringify(gallery.props)).not.toContain("not-client-safe");
  });
  it("prices.view projections are unchanged by media/lifecycle controls", async () => {
    auth(["products.view", "products.update", "prices.update", "products.delete"]);
    const tree = await page(); const edit = find(tree, VariantEditPanel)[0];
    expect(edit.props.canEditCost).toBe(false); expect(edit.props.canEditPrices).toBe(false);
    expect(JSON.stringify(edit.props)).not.toMatch(/741\.23|742\.99|867\.53|costPrice|compareAtPrice/);
    expect(find(tree, VariantPriceEditor)[0].props.variants).toEqual([]);
    for (const type of [ProductLifecycleControls, ProductImageManager]) expect(JSON.stringify(find(tree, type)[0].props)).not.toMatch(/867\.53|costPrice/);
  });
  it("failed variants omit all dependent islands without blocking gallery/lifecycle", async () => {
    m.variants.mockRejectedValue(new Error("variants unavailable")); const tree = await page();
    for (const type of [VariantEditPanel, VariantPriceEditor, CodeCreateForm]) expect(find(tree, type)).toHaveLength(0);
    for (const type of [ProductLifecycleControls, ProductImageManager]) expect(find(tree, type)).toHaveLength(1);
    render(tree); expect(screen.getByText("تعذّر تحميل أشكال البيع. البيانات غير متاحة حاليًا.")).toBeVisible(); expect(screen.getByRole("button", { name: "سجّل بيانات الصورة" })).toBeVisible();
  });
});
