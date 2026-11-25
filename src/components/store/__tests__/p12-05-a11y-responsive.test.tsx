// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SkipToMain } from "@/components/store/skip-to-main";
import { DataTable, Panel } from "@/components/admin/ui/surfaces";
import { CardBuy } from "@/components/store/card-buy";
import { publishCartSnapshot, resetCartStore } from "@/lib/frontend/cart-lines-store";

describe("P12-05 responsive & accessibility unit contracts", () => {
  afterEach(() => {
    cleanup();
    resetCartStore();
    h.pathname = "/";
  });

  it("renders skip link on Storefront and /admin/login, but suppresses it inside authenticated AdminShell routes", () => {
    h.pathname = "/";
    const { rerender } = render(<SkipToMain />);
    expect(screen.getByRole("link", { name: "تخطَّ إلى المحتوى" })).toHaveAttribute("href", "#main");

    h.pathname = "/admin/login";
    rerender(<SkipToMain />);
    expect(screen.getByRole("link", { name: "تخطَّ إلى المحتوى" })).toHaveAttribute("href", "#main");

    for (const adminRoute of ["/admin", "/admin/orders", "/admin/settings", "/admin/roles"]) {
      h.pathname = adminRoute;
      rerender(<SkipToMain />);
      expect(screen.queryByRole("link", { name: "تخطَّ إلى المحتوى" })).not.toBeInTheDocument();
    }
  });

  it("renders Admin Panel title as an accessible h2 and DataTable scroll wrapper as a focusable named region", () => {
    render(
      <Panel title="قائمة الطلبات" sub="أحدث الطلبات">
        <DataTable
          caption="جدول الطلبات"
          columns={[{ header: "الطلب" }, { header: "الحالة" }]}
          rows={[["ORD-1", "جديد"]]}
          emptyLabel="فارغ"
        />
      </Panel>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "قائمة الطلبات" });
    expect(heading).toHaveClass("adm-panel-title");
    const scrollRegion = screen.getByRole("region", { name: "جدول الطلبات" });
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(scrollRegion).toHaveClass("adm-table-scroll");
  });

  it("renders CardBuy in-cart stepper in a non-overflowing 2-column layout with full touch targets", () => {
    publishCartSnapshot({
      lines: [
        {
          productVariantId: "v-1",
          variantName: "1 كجم",
          productId: "p-1",
          quantity: "2",
          lineTotal: "90.00",
        },
      ],
    });
    const { container } = render(<CardBuy productId="p-1" />);
    const stepper = container.querySelector('[data-state="idle"]');
    expect(stepper).toHaveClass("grid", "grid-cols-2");
    expect(screen.getByText(/في السلة:/)).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "تقليل الكمية" })).toHaveClass("min-h-[44px]", "min-w-[44px]");
    expect(screen.getByRole("button", { name: "زيادة الكمية" })).toHaveClass("min-h-[44px]", "min-w-[44px]");
  });
});
