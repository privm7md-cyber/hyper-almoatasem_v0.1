// FE-3 filter-panel + load-more interaction tests (URL sync + append behavior).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FilterPanel } from "../filter-panel";
import { LoadMore } from "../load-more";
import { parseListingParams } from "@/lib/frontend/listing-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/search",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "/"} {...rest}>
      {children}
    </a>
  ),
}));

const BASE = parseListingParams({}, "search");

describe("FilterPanel", () => {
  it("pushes discrete filter changes into the URL, keeping the query", () => {
    push.mockClear();
    render(
      <FilterPanel
        query={BASE}
        brands={[{ id: "b1", name: "م1" }]}
        sortOptions={[{ value: "relevance", label: "الصلة" }]}
        sortValue="relevance"
      />,
    );
    fireEvent.click(screen.getByLabelText("متوفر فقط"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("inStock=true"));
  });

  it("clear-filters keeps the search query while dropping filter params", () => {
    push.mockClear();
    const q = parseListingParams({ type: "PIECE", inStock: "true" }, "search");
    render(
      <FilterPanel
        query={q}
        brands={[]}
        sortOptions={[{ value: "relevance", label: "الصلة" }]}
        sortValue="relevance"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /مسح الفلاتر/ }));
    const target = String(push.mock.calls[0][0]);
    expect(target).not.toMatch(/type=|inStock=/);
  });

  it("marks availability as unspecified and disables the stock filter without stock data (D02)", () => {
    push.mockClear();
    render(
      <FilterPanel
        query={BASE}
        brands={[]}
        sortOptions={[{ value: "relevance", label: "الصلة" }]}
        sortValue="relevance"
        availabilityKnown={false}
      />,
    );
    expect(screen.getByText(/التوفر غير محدد حاليًا/)).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: /متوفر فقط/ });
    expect(checkbox).toBeDisabled();
    // A disabled filter must not pretend to filter anything.
    fireEvent.click(checkbox);
    expect(push).not.toHaveBeenCalled();
  });

  it("hides the brand filter when the catalog has no brands (no empty control)", () => {
    render(
      <FilterPanel
        query={BASE}
        brands={[]}
        sortOptions={[{ value: "relevance", label: "الصلة" }]}
        sortValue="relevance"
      />,
    );
    expect(screen.queryByLabelText("العلامة التجارية")).not.toBeInTheDocument();
  });

  it("price fields follow the URL after back/forward (D25)", () => {
    const opts = { value: "relevance", label: "الصلة" };
    const { rerender } = render(
      <FilterPanel query={BASE} brands={[]} sortOptions={[opts]} sortValue="relevance" />,
    );
    expect(screen.getByLabelText("من سعر")).toHaveValue("");
    const withRange = parseListingParams({ minPrice: "25", maxPrice: "80" }, "search");
    rerender(<FilterPanel query={withRange} brands={[]} sortOptions={[opts]} sortValue="relevance" />);
    expect(screen.getByLabelText("من سعر")).toHaveValue("25");
    expect(screen.getByLabelText("إلى سعر")).toHaveValue("80");
  });

  it("rejects a reversed price range without navigating (D25)", () => {
    push.mockClear();
    render(
      <FilterPanel
        query={BASE}
        brands={[]}
        sortOptions={[{ value: "relevance", label: "الصلة" }]}
        sortValue="relevance"
      />,
    );
    fireEvent.change(screen.getByLabelText("من سعر"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("إلى سعر"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق السعر" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/أكبر من الثاني/);
  });

  it("accepts a valid price range and pushes it into the URL (D25)", () => {
    push.mockClear();
    render(
      <FilterPanel
        query={BASE}
        brands={[]}
        sortOptions={[{ value: "relevance", label: "الصلة" }]}
        sortValue="relevance"
      />,
    );
    fireEvent.change(screen.getByLabelText("من سعر"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("إلى سعر"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "تطبيق السعر" }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("minPrice=10"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("maxPrice=50"));
  });
});

describe("LoadMore", () => {
  it("renders nothing without a cursor and appends pages otherwise", async () => {
    const { unmount } = render(<LoadMore initialCursor={null} loadPage={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument();
    unmount();
    const loadPage = vi.fn().mockResolvedValue({ cards: [], nextCursor: null });
    render(<LoadMore initialCursor="cursor-1" loadPage={loadPage} />);
    fireEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));
    expect(loadPage).toHaveBeenCalledWith("cursor-1");
  });
});
