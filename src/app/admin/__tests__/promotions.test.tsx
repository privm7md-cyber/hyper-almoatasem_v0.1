// GAP-2 Promotions tests: promotions list page + create-form island (mocked POST).
// Identity AND reads mocked (no DB; fetch stubbed). Covers the actually-implemented
// surface only (`/admin/promotions` list + DRAFT-first create + status/search filters).
// Rule/target/buy-get editors live on the detail page — out of scope here, documented.

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

vi.mock("@/lib/promotions/queries", () => ({
  listPromotions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import AdminPromotionsPage from "../promotions/page";
import { PromotionCreateForm } from "@/components/admin/promotion-forms";
import { requirePermission } from "@/lib/auth/rbac";
import { listPromotions } from "@/lib/promotions/queries";

const REDIRECT = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });

function promoRow(id: string, status: string) {
  return { id, name: `عرض ${id}`, type: "PERCENTAGE", scope: "ORDER", status };
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
    render(
      <ToastProvider>{await AdminPromotionsPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("promotions.view");
  });

  it("renders promotions with detail links and preserves status+search in next link", async () => {
    authed();
    const rows = Array.from({ length: 21 }, (_, i) => promoRow(`pr-${i}`, "ACTIVE"));
    vi.mocked(listPromotions).mockResolvedValueOnce(rows as unknown as PromoRows);
    render(
      <ToastProvider>
        {await AdminPromotionsPage({ searchParams: sp({ status: "ACTIVE", search: "عرض" }) })}
      </ToastProvider>,
    );
    expect(screen.getByText("عرض pr-0")).toBeVisible();
    expect(document.querySelector('a[href="/admin/promotions/pr-0"]')).not.toBeNull();
    const href = screen.getByRole("link", { name: "الصفحة التالية" }).getAttribute("href") ?? "";
    expect(href).toContain("status=ACTIVE");
    expect(href).toContain("cursor=pr-20");
  });

  it("shows empty and error states; create section stays rendered", async () => {
    authed(["promotions.view", "promotions.create"]);
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    const { unmount } = render(
      <ToastProvider>{await AdminPromotionsPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.getByText("لا توجد عروض مطابقة")).toBeVisible();
    expect(screen.getByText(/عرض جديد/)).toBeVisible();
    unmount();
    vi.mocked(listPromotions).mockRejectedValueOnce(new Error("DB down"));
    render(
      <ToastProvider>{await AdminPromotionsPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.getByText("تعذّر التحميل")).toBeVisible();
  });

  it("hides the create form without promotions.create and names the missing key", async () => {
    authed(["promotions.view"]);
    vi.mocked(listPromotions).mockResolvedValueOnce([] as unknown as PromoRows);
    render(
      <ToastProvider>{await AdminPromotionsPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: "إنشاء العرض" })).toBeNull();
    expect(screen.getAllByText(/promotions\.create/).length).toBeGreaterThan(0);
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
    render(
      <ToastProvider>
        <PromotionCreateForm />
      </ToastProvider>,
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.click(screen.getByRole("button", { name: "إنشاء العرض" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the DRAFT-first create contract and surfaces server errors", async () => {
    render(
      <ToastProvider>
        <PromotionCreateForm />
      </ToastProvider>,
    );
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "CONFLICT", message: "تعارض.", details: null } }, 409));
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByLabelText("الاسم"), { target: { value: "عرض test" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء العرض" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعارض.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/promotions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ name: "عرض test", type: "PERCENTAGE", scope: "LINE" });
  });
});
