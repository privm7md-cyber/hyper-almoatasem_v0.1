// ADMIN PROMOTIONS SCREEN — the list page and the create form.
//
// The assertions pin the behaviour the panel promises: Arabic labels only, no
// machine token on the screen, and a keyset cursor that continues exactly
// where the page ended (no row skipped, no row repeated).

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

vi.mock("@/lib/promotions/queries", () => ({
  listPromotions: vi.fn(),
  listPromotionStates: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import AdminPromotionsPage from "../promotions/page";
import { PromotionCreateForm } from "@/components/admin/promotion-forms";
import { requirePermission } from "@/lib/auth/rbac";
import { listPromotions, listPromotionStates } from "@/lib/promotions/queries";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });

function promoRow(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `عرض ${id}`,
    type: "PERCENTAGE",
    scope: "ORDER",
    status,
    description: null,
    priority: 10,
    startAt: null,
    endAt: null,
    ...extra,
  };
}

type PromoRows = Awaited<ReturnType<typeof listPromotions>>;
const authed = (permissions = ["promotions.view"]) => {
  vi.mocked(requirePermission).mockResolvedValue({
    user: { id: "u", name: "n", email: "e" },
    roles: [],
    permissions,
  });
};
const sp = (q: Record<string, string>) => Promise.resolve(q);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("admin promotions list", () => {
  it("gates on promotions.view before reading", async () => {
    authed();
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    render(await AdminPromotionsPage({ searchParams: sp({}) }));
    expect(requirePermission).toHaveBeenCalledWith("promotions.view");
  });

  it("renders promotions with detail links and preserves state+search in next link", async () => {
    authed();
    const rows = Array.from({ length: 21 }, (_, i) => promoRow(`pr-${i}`, "ACTIVE"));
    vi.mocked(listPromotions).mockResolvedValueOnce(rows as unknown as PromoRows);
    vi.mocked(listPromotionStates).mockResolvedValueOnce([]);
    render(
      await AdminPromotionsPage({ searchParams: sp({ state: "LIVE", search: "عرض" }) }),
    );
    expect(screen.getByText("عرض pr-0")).toBeVisible();
    expect(document.querySelector('a[href="/admin/promotions/pr-0"]')).not.toBeNull();
    const href = screen.getByRole("link", { name: "الصفحة اللي بعد كده" }).getAttribute("href") ?? "";
    expect(href).toContain("state=LIVE");
    expect(href).toContain("cursor=pr-19");
  });

  it("speaks Arabic only — the scope reads by meaning and no token is printed", async () => {
    authed();
    vi.mocked(listPromotions).mockResolvedValueOnce([
      promoRow("pr-0", "ACTIVE"),
    ] as unknown as PromoRows);
    vi.mocked(listPromotionStates).mockResolvedValueOnce([]);
    const { container } = render(await AdminPromotionsPage({ searchParams: sp({}) }));
    const table = within(container.querySelector("table") as HTMLElement);
    expect(table.getByText("على إجمالي الطلب كله")).toBeVisible();
    expect(table.getByText("الخصم بيتحسب على إجمالي الطلب كله.")).toBeVisible();
    expect(table.getByText("خصم بنسبة مئوية")).toBeVisible();
    expect(table.getByText("شغّال دلوقتي")).toBeVisible();
    expect(screen.queryByText("ORDER")).toBeNull();
    expect(screen.queryByText("PERCENTAGE")).toBeNull();
    expect(screen.queryByText("ACTIVE")).toBeNull();
  });

  it("never calls a finished offer «شغّال»: the effective state wins over the stored one", async () => {
    authed();
    // Stored ACTIVE, but the window closed yesterday.
    vi.mocked(listPromotions).mockResolvedValueOnce([
      promoRow("pr-0", "ACTIVE", { endAt: "2020-01-01T00:00:00.000Z" }),
      promoRow("pr-1", "ACTIVE", { startAt: "2999-01-01T00:00:00.000Z" }),
      promoRow("pr-2", "DRAFT"),
    ] as unknown as PromoRows);
    vi.mocked(listPromotionStates).mockResolvedValueOnce([]);
    const { container } = render(await AdminPromotionsPage({ searchParams: sp({}) }));
    const table = within(container.querySelector("table") as HTMLElement);
    // The effective state of each row (the stored state is shown next to it).
    expect(table.getByText("منتهي")).toBeVisible();
    expect(table.getByText("مجدول")).toBeVisible();
    expect(table.getAllByText("مسودة").length).toBeGreaterThan(0);
    expect(table.queryByText("شغّال دلوقتي")).toBeNull();
  });

  it("counts the offers per effective state from the same rule the filter uses", async () => {
    authed();
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    vi.mocked(listPromotionStates).mockResolvedValueOnce([
      { id: "a", status: "ACTIVE", startAt: null, endAt: null },
      { id: "b", status: "ACTIVE", startAt: null, endAt: null },
      { id: "c", status: "ACTIVE", startAt: null, endAt: new Date("2020-01-01") },
      { id: "d", status: "DRAFT", startAt: null, endAt: null },
    ]);
    render(await AdminPromotionsPage({ searchParams: sp({}) }));
    expect(screen.getByText("2 عرض")).toBeVisible();
    // EXPIRED and DRAFT hold one offer each.
    expect(screen.getAllByText("1 عرض")).toHaveLength(2);
    // The state reaches the query, not the browser.
    expect(vi.mocked(listPromotions).mock.calls[0][0]).toMatchObject({ state: null });
  });

  it("passes the chosen effective state to the server-side query", async () => {
    authed();
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    vi.mocked(listPromotionStates).mockResolvedValueOnce([]);
    render(await AdminPromotionsPage({ searchParams: sp({ state: "EXPIRED" }) }));
    expect(vi.mocked(listPromotions).mock.calls[0][0]).toMatchObject({ state: "EXPIRED" });
    expect(screen.getByLabelText("حالة العرض")).toHaveValue("EXPIRED");
  });

  it("shows empty and error states; create section stays rendered", async () => {
    authed(["promotions.view", "promotions.create"]);
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    const { unmount } = render(await AdminPromotionsPage({ searchParams: sp({}) }));
    expect(screen.getByText("مفيش عروض مطابقة")).toBeVisible();
    expect(screen.getByText(/عرض جديد/)).toBeVisible();
    unmount();
    vi.mocked(listPromotions).mockRejectedValueOnce(new Error("DB down"));
    render(await AdminPromotionsPage({ searchParams: sp({}) }));
    expect(screen.getByText("مش قادرين نحمّل العروض دلوقتي")).toBeVisible();
  });

  it("hides the create form without promotions.create and names the missing capability in Arabic", async () => {
    authed(["promotions.view"]);
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    render(await AdminPromotionsPage({ searchParams: sp({}) }));
    expect(screen.queryByRole("button", { name: "إنشاء العرض" })).toBeNull();
    expect(screen.getAllByText(/إضافة عرض جديد/).length).toBeGreaterThan(0);
    expect(screen.getByText(/غير متاح لحسابك/)).toBeVisible();
    expect(screen.queryByText(/promotions\.create/)).toBeNull();
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminPromotionsPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listPromotions).not.toHaveBeenCalled();
    vi.mocked(requirePermission).mockRejectedValueOnce(REDIRECT);
    await expect(AdminPromotionsPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("promotion create form (mocked POST)", () => {
  it("blocks empty names locally without any request", async () => {
    render(<PromotionCreateForm />);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.click(screen.getByRole("button", { name: "إنشاء العرض" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a missing discount value locally without any request", async () => {
    render(<PromotionCreateForm />);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByLabelText(/اسم العرض/), { target: { value: "عرض test" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء العرض" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("قيمة الخصم مطلوبة");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the create contract with the value the server requires", async () => {
    render(<PromotionCreateForm />);
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "pr-new" }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByLabelText(/اسم العرض/), { target: { value: "عرض test" } });
    fireEvent.change(screen.getByLabelText(/نسبة الخصم/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء العرض" }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect((screen.getByLabelText(/اسم العرض/) as HTMLInputElement).value).toBe(""),
    );
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/promotions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "عرض test",
      type: "PERCENTAGE",
      scope: "LINE",
      discountPercent: "10",
    });
  });

  it("surfaces the Arabic conflict sentence when the server refuses", async () => {
    render(<PromotionCreateForm />);
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "CONFLICT", message: "تعارض.", details: null } }, 409));
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByLabelText(/اسم العرض/), { target: { value: "عرض test" } });
    fireEvent.change(screen.getByLabelText(/نسبة الخصم/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء العرض" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("فيه حد تاني عدّل نفس الحاجة قبلك");
    expect(screen.queryByText("تعارض.")).toBeNull();
  });
});
