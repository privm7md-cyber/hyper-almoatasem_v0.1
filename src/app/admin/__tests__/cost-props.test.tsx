import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/auth/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findFirst: vi.fn() } } }));
vi.mock("@/lib/catalog/queries", () => ({
  getProduct: vi.fn(), listVariantsWithCodes: vi.fn(), listCategoriesForAdmin: vi.fn(), listBrandsForAdmin: vi.fn(),
}));
vi.mock("@/lib/admin/queries", () => ({ getAudit: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/frontend/api-client", () => ({ apiRequest: vi.fn() }));

import ProductPage from "../products/[id]/page";
import AuditPage from "../audit-logs/[id]/page";
import { VariantEditPanel, VariantEditForm } from "@/components/admin/variant-form";
import { VariantPriceEditor } from "@/components/admin/variant-price-editor";
import { requirePermission } from "@/lib/auth/rbac";
import { getProduct, listVariantsWithCodes, listCategoriesForAdmin, listBrandsForAdmin } from "@/lib/catalog/queries";
import { getAudit } from "@/lib/admin/queries";
import { apiRequest } from "@/lib/frontend/api-client";

const id = "00000000-0000-7000-8000-000000000001";
const cost = "867.53";
const base = { id, name: "عبوة اختبار", sizeValue: null, sizeUnit: null, isActive: true };
function auth(permissions: string[]) {
  vi.mocked(requirePermission).mockResolvedValue({ user: { id, name: "مشغل اختبار", email: "test@example.invalid" }, roles: [], permissions });
}
function islands(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((item) => islands(item, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(node.type === type ? [node] : []), ...islands(node.props.children as ReactNode, type)];
}
async function product(permissions: string[]) {
  auth(permissions);
  vi.mocked(getProduct).mockResolvedValue({
    id, name: "منتج اختبار", slug: "test", productType: "PIECE", unit: "PIECE", isActive: true, deletedAt: null,
    category: { id, name: "قسم اختبار" }, brand: null, description: null,
    createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"),
  } as unknown as Awaited<ReturnType<typeof getProduct>>);
  vi.mocked(listVariantsWithCodes).mockResolvedValue([{ ...base, productId: id, price: "900", compareAtPrice: "1000", costPrice: cost, codes: [] }] as unknown as Awaited<ReturnType<typeof listVariantsWithCodes>>);
  vi.mocked(listCategoriesForAdmin).mockResolvedValue({ rows: [], nextCursor: null });
  vi.mocked(listBrandsForAdmin).mockResolvedValue({ rows: [], nextCursor: null });
  return ProductPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
}

afterEach(() => vi.resetAllMocks());

describe("server-to-client price projection", () => {
  it.each([{ extra: [] }, { extra: ["products.update"] }, { extra: ["products.update", "prices.update"] }])("omits sensitive props without read permission: $extra", async ({ extra }) => {
    const tree = await product(["products.view", ...extra]);
    const edit = islands(tree, VariantEditPanel)[0];
    const variants = edit.props.variants as Record<string, unknown>[];
    expect(variants[0]).not.toHaveProperty("costPrice");
    expect(variants[0]).not.toHaveProperty("price");
    expect(variants[0]).not.toHaveProperty("compareAtPrice");
    expect(edit.props.canEditCost).toBe(false);
    expect(islands(tree, VariantPriceEditor)[0].props.variants).toEqual([]);
    expect(JSON.stringify(edit.props)).not.toContain(cost);
  });
  it("preserves cost for authorized reading and enables editing only with write permission", async () => {
    const tree = await product(["products.view", "products.update", "prices.view"]);
    const edit = islands(tree, VariantEditPanel)[0];
    expect((edit.props.variants as Record<string, unknown>[])[0].costPrice).toBe(cost);
    expect(edit.props.canEditCost).toBe(false);
    const writable = await product(["products.view", "products.update", "prices.view", "prices.update"]);
    expect(islands(writable, VariantEditPanel)[0].props.canEditCost).toBe(true);
  });
  it("keeps descriptive edits usable without sending hidden pricing fields", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {}, meta: {} });
    render(<VariantEditForm variant={base} />);
    expect(screen.queryByLabelText("سعر التكلفة")).toBeNull();
    expect(screen.queryByLabelText("السعر قبل الخصم")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "احفظ بيانات الشكل" })); });
    expect(apiRequest).toHaveBeenCalled();
    const payload = vi.mocked(apiRequest).mock.calls[0][1]?.body;
    expect(payload).not.toHaveProperty("costPrice");
    expect(payload).not.toHaveProperty("compareAtPrice");
  });
});

describe("audit rendered output projection", () => {
  it.each([false, true])("applies cost read permission to both visible and technical output: %s", async (allowed) => {
    auth(["audit_logs.view", ...(allowed ? ["prices.view"] : [])]);
    vi.mocked(getAudit).mockResolvedValue({
      id, user_id: null, actor_type: "ADMIN", action: "variants.update", entity_type: "product_variants", entity_id: id,
      old_values: { costPrice: cost, name: "الاسم السابق" }, new_values: { nested: [{ cost_price: cost }], name: "الاسم الجديد" },
      ip_address: null, user_agent: null, created_at: new Date("2026-11-01T00:00:00Z"),
    });
    const { container } = render(await AuditPage({ params: Promise.resolve({ id }) }));
    expect(container.textContent?.includes(cost)).toBe(allowed);
    expect(container.querySelector("pre")?.textContent?.includes("costPrice")).toBe(allowed);
    expect(container.textContent).toContain("الاسم السابق");
    expect(container.textContent).toContain("الاسم الجديد");
  });
});
