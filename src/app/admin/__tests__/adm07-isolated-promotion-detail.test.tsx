// ADM-07 promotion detail — isolated (no database, no network, no writes).
//
// The screen is the owner's working surface for one offer: what it does now
// (the effective state), what it costs (the price preview), what it applies
// to (the targets), and the rules it carries (the forms that must start from
// the SAVED values, never from empty inputs).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

const m = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getPromotion: vi.fn(),
  previewPromotion: vi.fn(),
  getBrand: vi.fn(),
  getCategory: vi.fn(),
  getProduct: vi.fn(),
  getVariant: vi.fn(),
  loadPromotionCatalog: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: m.requirePermission,
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/promotions/queries", () => ({
  getPromotion: m.getPromotion,
}));

vi.mock("@/lib/promotions/admin-preview", () => ({
  previewPromotion: m.previewPromotion,
}));

vi.mock("@/lib/catalog/queries", () => ({
  getBrand: m.getBrand,
  getCategory: m.getCategory,
  getProduct: m.getProduct,
  getVariant: m.getVariant,
}));

vi.mock("@/lib/catalog/media", () => ({
  listPrimaryImagesForProducts: vi.fn(),
}));

vi.mock("@/lib/admin/promotion-catalog", () => ({
  loadPromotionCatalog: m.loadPromotionCatalog,
}));

// `@/lib/api/serialize` carries `import "server-only"`; stubbed with the
// same pure behaviour (the domain mapping stays real and under test).
vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminPromotionDetailPage from "../promotions/[id]/page";

const PROMO_ID = "11111111-1111-4111-8111-111111111111";

function promoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMO_ID,
    name: "خصم الجمعة",
    description: "خصم على الأرز",
    type: "PERCENTAGE",
    scope: "LINE",
    status: "ACTIVE",
    startAt: null,
    endAt: null,
    discountPercent: "20",
    discountAmount: null,
    fixedPrice: null,
    priority: 10,
    isStackable: false,
    usageLimit: null,
    usedCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    targets: [{ id: "t-1", targetType: "PRODUCT", targetId: "product-1" }],
    rules: {
      minimumQuantity: "3",
      minimumAmount: "250.00",
      maximumDiscount: "100.00",
    },
    buyGetRules: null,
    ...overrides,
  };
}

const PREVIEW_ROW = {
  variantId: "variant-1",
  productId: "product-1",
  productName: "أرز مصري",
  variantName: "كيس 1 كجم",
  imageUrl: null,
  unitLabel: "كجم",
  originalPrice: "100.00",
  discountAmount: "20.00",
  finalPrice: "80.00",
  savingsPercent: "20.00",
  applies: true,
  blockedBy: null,
  reason: null,
  availableQuantity: "12.000",
};

const authed = (permissions = ["promotions.view", "promotions.update", "prices.view"]) => {
  m.requirePermission.mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions,
  });
};

const renderPage = async (searchParams: Record<string, string> = {}) =>
  render(
    await AdminPromotionDetailPage({
      params: Promise.resolve({ id: PROMO_ID }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  m.loadPromotionCatalog.mockResolvedValue([]);
  m.getProduct.mockResolvedValue(null);
});

describe("ADM-07 promotion detail", () => {
  it("shows the effective state, not the stored one", async () => {
    authed();
    m.getPromotion.mockResolvedValue(promoRow({ endAt: new Date("2020-01-01T00:00:00.000Z") }));
    m.previewPromotion.mockResolvedValue({ rows: [PREVIEW_ROW] });
    await renderPage();
    // The pill in the head and the state in the summary both say it.
    expect(screen.getAllByText("منتهي").length).toBeGreaterThan(0);
    expect(screen.queryByText("شغّال دلوقتي")).toBeNull();
  });

  it("starts the rules form from the saved rules, never from empty inputs", async () => {
    authed();
    m.getPromotion.mockResolvedValue(promoRow());
    m.previewPromotion.mockResolvedValue({ rows: [PREVIEW_ROW] });
    await renderPage();
    expect((screen.getByLabelText(/أقل كمية/) as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText(/أقل قيمة طلب/) as HTMLInputElement).value).toBe("250.00");
    expect((screen.getByLabelText(/أقصى قيمة خصم/) as HTMLInputElement).value).toBe("100.00");
  });

  it("starts the buy-get form from the saved rule", async () => {
    authed();
    m.getPromotion.mockResolvedValue(
      promoRow({
        type: "BUY_X_GET_Y",
        discountPercent: null,
        buyGetRules: {
          id: "bg-1",
          buyQuantity: { toString: () => "2" },
          getQuantity: { toString: () => "1" },
          discountPercent: { toString: () => "50" },
          freeVariantId: null,
        },
      }),
    );
    m.previewPromotion.mockResolvedValue({ rows: [] });
    await renderPage();
    expect((screen.getByLabelText(/كمية الشراء/) as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText(/كمية المجاني/) as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText(/نسبة الخصم على الكمية التانية/) as HTMLInputElement).value).toBe("50");
  });

  it("shows the preview numbers the backend engine produced", async () => {
    authed();
    m.getPromotion.mockResolvedValue(promoRow());
    m.previewPromotion.mockResolvedValue({
      promotionId: PROMO_ID,
      promotionName: "خصم الجمعة",
      type: "PERCENTAGE",
      scope: "LINE",
      state: "ACTIVE",
      rows: [PREVIEW_ROW],
      empty: false,
    });
    await renderPage();
    expect(screen.getByText("معاينة السعر")).toBeVisible();
    expect(screen.getAllByText("100.00 ج.م").length).toBeGreaterThan(0);
    expect(screen.getAllByText("80.00 ج.م").length).toBeGreaterThan(0);
    expect(screen.getByText(/توفير 20.00%/)).toBeVisible();
  });

  it("hides the price preview from an account without prices.view", async () => {
    authed(["promotions.view", "promotions.update"]);
    m.getPromotion.mockResolvedValue(promoRow());
    await renderPage();
    expect(m.previewPromotion).not.toHaveBeenCalled();
    expect(screen.getByText(/محتاجة صلاحية «عرض الأسعار»/)).toBeVisible();
    expect(screen.queryByText("80.00 ج.م")).toBeNull();
  });

  it("offers the catalogue as the place to pick products, with real names", async () => {
    authed();
    m.getPromotion.mockResolvedValue(promoRow());
    m.previewPromotion.mockResolvedValue({ rows: [] });
    m.loadPromotionCatalog.mockResolvedValue([
      {
        id: "product-2",
        name: "سكر أبيض",
        brandName: "الهدى",
        price: "35.00",
        variantCount: 2,
        imageUrl: null,
      },
    ]);
    await renderPage();
    expect(screen.getByText("اختيار منتجات من الكتالوج")).toBeVisible();
    expect(screen.getByText("سكر أبيض")).toBeVisible();
    expect(screen.getByText(/الهدى/)).toBeVisible();
    expect(screen.getByRole("button", { name: "أضف للعرض" })).toBeVisible();
  });
});
