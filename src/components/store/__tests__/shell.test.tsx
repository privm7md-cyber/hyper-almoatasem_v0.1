// FE-2 shell + card unit tests (DTO fixtures are test data, never API results).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";import { StoreHeader } from "../store-header";
import { StoreFooter } from "../store-footer";
import { ProductCard } from "../product-card";
import { SearchBox } from "../search-box";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";

const push = vi.fn();
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "/"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

const CARD: HomeProductCard = {
  id: "p1",
  name: "أرز بسمتي",
  slug: "aruz",
  unit: "PIECE",
  productType: "PIECE",
  saleStepGrams: null,
  sizeValue: null,
  sizeUnit: null,
  price: "320.00",
  compareAt: "360.00",
  stock: "in",
  image: null,
  brandName: "المعتصم",
};

describe("store shell", () => {
  it("header shows wordmark and real search entry", () => {
    render(<StoreHeader />);
    expect(screen.getByRole("link", { name: /هايبر المعتصم/ })).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("footer links only to real destinations (no 404 links)", () => {
    render(<StoreFooter />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      // FE-9: the footer exposes the published informational pages only; pages
      // whose content is still blocked on owner input are deliberately absent.
      // Phase-11: the browse column also links the real catalogue / account
      // destinations (every one of them is an existing route).
      expect([
        "/",
        "/search",
        "/categories",
        "/brands",
        "/cart",
        "/account",
        "/orders",
        "/about",
        "/faq",
        "/delivery",
        "/cancellation",
        "/replacement",
        "/order-help",
      ]).toContain(href);
    }
    expect(screen.getByText(/احتياجات بيتك/)).toBeInTheDocument();
  });

  it("product card shows authoritative fields, never invented claims", () => {
    render(<ProductCard product={CARD} />);
    expect(screen.getByRole("article", { name: "أرز بسمتي" })).toBeInTheDocument();
    expect(screen.getByText("320.00 ج.م")).toBeInTheDocument();
    expect(screen.getByText("متوفر")).toBeInTheDocument();
    expect(screen.queryByText(/الأكثر مبيعًا|خصم.*%/)).not.toBeInTheDocument();
  });

  it("product card renders OOS without hiding and without price invention", () => {
    render(<ProductCard product={{ ...CARD, stock: "oos", price: null }} />);
    expect(screen.getByText("غير متوفر")).toBeInTheDocument();
    expect(screen.getByText("السعر عند الاختيار")).toBeInTheDocument();
  });

  it("product card falls back neutrally without image", () => {
    render(<ProductCard product={CARD} />);
    expect(screen.getByText("بلا صورة")).toBeInTheDocument();
  });

  it("search submits valid queries and ignores too-short input (no per-keystroke fetch)", () => {
    push.mockClear();
    render(<SearchBox />);
    const input = screen.getByLabelText("ابحث عن منتج");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "أرز" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/search\?q=/));
  });
});
