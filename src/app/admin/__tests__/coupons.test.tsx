// First-coupon creation regression tests: all auth, DB and query modules are mocked.
// POST assertions use stubbed fetch only; no live authorization or database writes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/promotions/queries", () => ({
  getPromotion: vi.fn(),
  listCoupons: vi.fn(),
  listCouponOfferOptions: vi.fn(),
  listPromotions: vi.fn(),
}));

// ADM-08: the coupons screen reads through the admin coupon query module
// (the real status + the real usage money), not the plain coupon list.
vi.mock("@/lib/promotions/admin-coupon-queries", () => ({
  listCouponsAdmin: vi.fn(),
}));

import AdminCouponsPage from "../coupons/page";
import { CouponCreateForm } from "@/components/admin/coupon-forms";
import { requirePermission } from "@/lib/auth/rbac";
import { getPromotion, listCouponOfferOptions, listPromotions } from "@/lib/promotions/queries";
import { listCouponsAdmin } from "@/lib/promotions/admin-coupon-queries";

const offer = {
  id: "01900000-0000-7000-8000-000000000001",
  name: "عرض أول كود",
  status: "ACTIVE",
};
const fetchSpy = vi.fn();
type CouponRows = Awaited<ReturnType<typeof listCouponsAdmin>>;
type CouponSearch = { search?: string; active?: string; cursor?: string };
const sp = (params: CouponSearch = {}) => Promise.resolve(params);

function authed(permissions = ["coupons.view", "coupons.create"]) {
  vi.mocked(requirePermission).mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions,
  });
}

function couponRow(promotionId: string) {
  // The admin row shape: the raw row with the computed status and the usage
  // aggregates the admin screen renders.
  return {
    id: "coupon-1",
    promotion_id: promotionId,
    code: "EXISTING",
    usage_limit: null,
    used_count: 0,
    per_customer_limit: null,
    minimum_order_amount: null,
    start_at: null,
    end_at: null,
    is_active: true,
    created_at: new Date("2026-10-01T00:00:00Z"),
    updated_at: new Date("2026-10-01T00:00:00Z"),
    promo_name: "عرض مرجعي",
    promo_type: "PERCENTAGE",
    promo_scope: "LINE",
    promo_status: "ACTIVE",
    promo_usage_limit: null,
    promo_used_count: 0,
    pdp: "10",
    pda: null,
    promo_max: null,
    own_ok: true,
    parent_ok: true,
    status: "ACTIVE",
    usage_rows: 0,
    total_discount: "0",
    distinct_customers: 0,
    last_used_at: null,
  };
}

function chooser() {
  return screen.getByRole("combobox", { name: "العرض اللي عليه الكود" }) as HTMLSelectElement;
}

beforeEach(() => {
  authed();
  vi.mocked(listCouponsAdmin).mockResolvedValue([]);
  vi.mocked(listCouponOfferOptions).mockResolvedValue([offer]);
  vi.mocked(getPromotion).mockResolvedValue(null);
  fetchSpy.mockRejectedValue(new Error("Unexpected mocked request"));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("admin coupons creation prerequisites", () => {
  it("loads creation options for the first coupon, even without promotions.view", async () => {
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(requirePermission).toHaveBeenCalledWith("coupons.view");
    expect(screen.getByText("مفيش أكواد خصم مطابقة")).toBeVisible();
    expect(within(chooser()).getByRole("option", { name: "عرض أول كود — شغّال" })).toHaveValue(offer.id);
    expect(screen.getByRole("button", { name: "إنشاء الكود" })).toBeEnabled();
    expect(listCouponOfferOptions).toHaveBeenCalledExactlyOnceWith();
    expect(getPromotion).not.toHaveBeenCalled();
    expect(listPromotions).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["filtered", "cursor", "filtered cursor"])("keeps options when the %s coupon result is empty", async (scenario) => {
    const params: CouponSearch = {
      ...(scenario.includes("filtered") ? { search: "MISSING", active: "false" } : {}),
      ...(scenario.includes("cursor") ? { cursor: "past-end" } : {}),
    };
    render(await AdminCouponsPage({ searchParams: sp(params) }));
    expect(listCouponsAdmin).toHaveBeenCalledWith({
      limit: 20,
      search: params.search ? params.search.toUpperCase() : null,
      active: params.active === "false" ? false : null,
      cursor: params.cursor ?? null,
      status: null,
    });
    expect(listCouponOfferOptions).toHaveBeenCalledExactlyOnceWith();
    expect(chooser().options[1]).toHaveValue(offer.id);
    expect(screen.getByRole("button", { name: "إنشاء الكود" })).toBeEnabled();
    expect(getPromotion).not.toHaveBeenCalled();
  });

  it("does not erase creation options when the coupon list fails", async () => {
    vi.mocked(listCouponsAdmin).mockRejectedValueOnce(new Error("Coupon list unavailable"));
    render(await AdminCouponsPage({ searchParams: sp({ cursor: "past-end" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("مش قادرين نحمّل أكواد الخصم دلوقتي");
    expect(listCouponOfferOptions).toHaveBeenCalledOnce();
    expect(chooser().options[1]).toHaveValue(offer.id);
    expect(screen.getByRole("button", { name: "إنشاء الكود" })).toBeEnabled();
    expect(getPromotion).not.toHaveBeenCalled();
  });

  it("shows a chooser read error with a real retry link, never row enrichment as options", async () => {
    const referenced = { id: "row-offer", name: "عرض الكود القديم", status: "DISABLED" };
    vi.mocked(listCouponsAdmin).mockResolvedValueOnce([
      { ...couponRow(referenced.id), promo_name: referenced.name },
    ] as unknown as CouponRows);
    vi.mocked(listCouponOfferOptions).mockRejectedValueOnce(new Error("Chooser unavailable"));
    authed(["coupons.view", "coupons.create", "promotions.view"]);
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(screen.getByText(referenced.name)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("مش قادرين نحمّل العروض لإنشاء الكود دلوقتي");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeEnabled();
    expect(screen.queryByText("لازم يكون فيه عرض موجود قبل إنشاء كود خصم")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "العرض اللي عليه الكود" })).toBeNull();
    expect(screen.queryByRole("button", { name: "إنشاء الكود" })).toBeNull();
    expect(document.querySelector('a[href="/admin/promotions"]')).toBeNull();
  });

  it.each([true, false])("shows the legitimate empty prerequisite with promotions.view=%s", async (canViewPromotions) => {
    vi.mocked(listCouponOfferOptions).mockResolvedValueOnce([]);
    authed(["coupons.view", "coupons.create", ...(canViewPromotions ? ["promotions.view"] : [])]);
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(screen.getByText("لازم يكون فيه عرض موجود قبل إنشاء كود خصم")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "إنشاء الكود" })).toBeDisabled();
    expect(chooser().options).toHaveLength(1);
    if (canViewPromotions) {
      expect(screen.getByRole("link", { name: "افتح العروض" })).toHaveAttribute("href", "/admin/promotions");
    } else {
      expect(document.querySelector('a[href="/admin/promotions"]')).toBeNull();
      expect(screen.getByText(/كلّم مسؤول العروض/)).toBeVisible();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not query options or render a form without coupons.create (existing coupon=%s)", async (hasCoupon) => {
    authed(["coupons.view", "promotions.view"]);
    if (hasCoupon) {
      vi.mocked(listCouponsAdmin).mockResolvedValueOnce([couponRow(offer.id)] as unknown as CouponRows);
      vi.mocked(getPromotion).mockResolvedValueOnce(offer as unknown as Awaited<ReturnType<typeof getPromotion>>);
    }
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(listCouponOfferOptions).not.toHaveBeenCalled();
    expect(listPromotions).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: "العرض اللي عليه الكود" })).toBeNull();
    expect(screen.queryByRole("button", { name: "إنشاء الكود" })).toBeNull();
    expect(screen.getByText(/إضافة كود خصم — غير متاح لحسابك/)).toBeVisible();
    expect(screen.queryByText(/coupons\.create/)).toBeNull();
  });

  it.each([["DRAFT", "مسودة"], ["DISABLED", "موقوف"]])("offers %s promotions for planning", async (status, label) => {
    vi.mocked(listCouponOfferOptions).mockResolvedValueOnce([{ ...offer, status }]);
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(within(chooser()).getByRole("option", { name: `${offer.name} — ${label}` })).toHaveValue(offer.id);
    expect(screen.getByRole("button", { name: "إنشاء الكود" })).toBeEnabled();
    expect(document.body.textContent).not.toContain(status);
  });

  it.each([200, 201])("passes only 200 options and announces truncation for %s results", async (count) => {
    const options = Array.from({ length: count }, (_, i) => ({
      id: `offer-${i}`,
      name: `عرض ${String(i).padStart(3, "0")}`,
      status: "ACTIVE",
    }));
    vi.mocked(listCouponOfferOptions).mockResolvedValueOnce(options);
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(Array.from(chooser().options).slice(1).map((option) => option.value)).toEqual(
      options.slice(0, 200).map((option) => option.id),
    );
    const notice = screen.queryByText(/فيه أكتر من 200 عرض/);
    if (count > 200) expect(notice).toBeVisible();
    else expect(notice).toBeNull();
  });

  it("keeps referenced row names separate from creation options", async () => {
    const referenced = { id: "row-offer", name: "عرض قديم", status: "DISABLED" };
    vi.mocked(listCouponsAdmin).mockResolvedValueOnce([
      { ...couponRow(referenced.id), promo_name: referenced.name },
    ] as unknown as CouponRows);
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(screen.getByText(referenced.name)).toBeVisible();
    // The offer name travels WITH the row: no second read, and the row's
    // offer never becomes a creation option.
    expect(getPromotion).not.toHaveBeenCalled();
    expect(Array.from(chooser().options).map((option) => option.value)).toEqual(["", offer.id]);
    expect(document.querySelector('a[href="/admin/coupons/coupon-1"]')).not.toBeNull();
  });

  it("never turns a row's offer into a creation option, even when the chooser fails", async () => {
    vi.mocked(listCouponsAdmin).mockResolvedValueOnce([
      { ...couponRow("row-offer"), promo_name: "عرض قديم" },
    ] as unknown as CouponRows);
    vi.mocked(listCouponOfferOptions).mockRejectedValueOnce(new Error("Chooser unavailable"));
    render(await AdminCouponsPage({ searchParams: sp() }));
    expect(screen.getByText("عرض قديم")).toBeVisible();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "العرض اللي عليه الكود" })).toBeNull();
  });

  it("denies identity before reading coupons, creation options or row names", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("NEXT_FORBIDDEN"));
    await expect(AdminCouponsPage({ searchParams: sp() })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listCouponsAdmin).not.toHaveBeenCalled();
    expect(listCouponOfferOptions).not.toHaveBeenCalled();
    expect(getPromotion).not.toHaveBeenCalled();
    expect(listPromotions).not.toHaveBeenCalled();
  });
});

describe("coupon create form (mocked POST)", () => {
  it("disables zero-option submission and also blocks a direct submit event", () => {
    render(<CouponCreateForm offers={[]} />);
    const submit = screen.getByRole("button", { name: "إنشاء الكود" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.submit(submit.closest("form") as HTMLFormElement);
    expect(screen.getByRole("alert")).toHaveTextContent("لازم يكون فيه عرض موجود قبل إنشاء كود خصم.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves missing-selection validation when options are available", () => {
    render(<CouponCreateForm offers={[offer]} />);
    fireEvent.change(screen.getByLabelText(/^الكود/), { target: { value: "FIRST10" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الكود" }));
    expect(screen.getByRole("alert")).toHaveTextContent("اختار العرض اللي الكود هيكون عليه.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits the first coupon with a DRAFT promotionId through stubbed POST only", async () => {
    vi.mocked(listCouponOfferOptions).mockResolvedValueOnce([{ ...offer, status: "DRAFT" }]);
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "coupon-new" }, meta: {} }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    render(await AdminCouponsPage({ searchParams: sp() }));
    fireEvent.change(chooser(), { target: { value: offer.id } });
    fireEvent.change(screen.getByLabelText(/^الكود/), { target: { value: "FIRST10" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "إنشاء الكود" }));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^الكود/)).toHaveValue("");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/coupons");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      promotionId: offer.id,
      code: "FIRST10",
      startAt: null,
      endAt: null,
      isActive: true,
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
