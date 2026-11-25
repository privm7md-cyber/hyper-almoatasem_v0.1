// FE-3 filter-panel + load-more interaction tests (URL sync + append behavior).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FilterPanel } from "../filter-panel";
import { LoadMore } from "../load-more";
import { parseListingParams } from "@/lib/frontend/listing-params";
import type { HomeProductCard } from "@/lib/frontend/storefront-reads";

/** A full-shaped fixture row for the islands (type-only import — no server code). */
function fakeCard(id: string): HomeProductCard {
  return {
    id,
    name: `ن${id}`,
    slug: `s-${id}`,
    unit: "PIECE",
    productType: "PIECE",
    saleStepGrams: null,
    sizeValue: null,
    sizeUnit: null,
    price: "10",
    compareAt: null,
    stock: "unknown",
    image: null,
    brandName: null,
  };
}

const push = vi.fn();
// P08: the "current URL" of the mocked router is parametrizable — a test sets
// `nav.current` (URLSearchParams input) before rendering; default empty.
const nav = { current: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/search",
  useSearchParams: () => new URLSearchParams(nav.current),
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

  // === P08-T03: context change → new URL WITHOUT a cursor; everything else kept ===
  it("sort change keeps the query and other filters and never writes dir or a cursor (search)", () => {
    push.mockClear();
    nav.current = "q=%D8%B9%D8%B3%D9%84&type=PIECE";
    render(
      <FilterPanel
        query={parseListingParams(Object.fromEntries(new URLSearchParams(nav.current)), "search")}
        brands={[]} // no brand options on this surface — the control is hidden, not a fake "all"
        sortOptions={[
          { value: "relevance", label: "الصلة" },
          { value: "newest", label: "الأحدث" }, // bare values — the search contract has no dir
        ]}
        sortValue="relevance"
      />,
    );
    fireEvent.change(screen.getByLabelText("ترتيب النتائج"), { target: { value: "newest" } });
    const target = String(push.mock.calls[0][0]);
    expect(target).toContain("sort=newest");
    expect(target).toContain("type=PIECE");
    expect(target).toContain("q=%D8%B9%D8%B3%D9%84");
    expect(target).not.toContain("dir=");
    expect(target).not.toContain("cursor=");
  });

  it("type change keeps q and sort (context change navigates to page 1 — no cursor in any URL)", () => {
    push.mockClear();
    nav.current = "q=%D8%B9%D8%B3%D9%84&sort=newest";
    render(
      <FilterPanel
        query={parseListingParams(Object.fromEntries(new URLSearchParams(nav.current)), "search")}
        brands={[]}
        sortOptions={[{ value: "newest", label: "الأحدث" }]}
        sortValue="newest"
      />,
    );
    fireEvent.change(screen.getByLabelText("نوع المنتج"), { target: { value: "WEIGHT" } });
    const target = String(push.mock.calls[0][0]);
    expect(target).toContain("type=WEIGHT");
    expect(target).toContain("q=%D8%B9%D8%B3%D9%84");
    expect(target).toContain("sort=newest");
    expect(target).not.toContain("cursor=");
    nav.current = "";
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

  // === P08-T03: the duplicate-send guard is synchronous, not just disabled ===
  it("a same-task double click fires loadPage ONCE (no duplicate keyset page)", () => {
    const loadPage = vi.fn().mockResolvedValue({ cards: [fakeCard("p2")], nextCursor: null });
    render(<LoadMore initialCursor="cur-1" loadPage={loadPage} />);
    const btn = screen.getByRole("button", { name: "تحميل المزيد" });
    // Two synchronous clicks in ONE task: before the first render commits,
    // `pending` state is still false for the second handler call — only the
    // sync ref guard stamped at send time stops the duplicate.
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("a failed append keeps the SAME cursor; retry re-runs exactly that page", async () => {
    const loadPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ cards: [fakeCard("p2")], nextCursor: null });
    render(<LoadMore initialCursor="cur-7" loadPage={loadPage} />);
    fireEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));
    await screen.findByRole("button", { name: "إعادة محاولة التحميل" });
    fireEvent.click(screen.getByRole("button", { name: "إعادة محاولة التحميل" }));
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2));
    expect(loadPage).toHaveBeenNthCalledWith(1, "cur-7");
    expect(loadPage).toHaveBeenNthCalledWith(2, "cur-7"); // same page retried — never skipped
  });

  it("end of results: nextCursor null hides the control after the final append (never a fake page)", async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValue({ cards: [fakeCard("p2")], nextCursor: null });
    render(<LoadMore initialCursor="cur-last" loadPage={loadPage} />);
    fireEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /تحميل المزيد|إعادة محاولة التحميل/ }),
      ).not.toBeInTheDocument();
    });
  });

  it("fixed fixture: appended pages render in exact keyset order with NO duplicate and NO skipped id", async () => {
    // Two server pages from one fixed ordered dataset: [a,b] + [c] → end.
    const page1: { cards: HomeProductCard[]; nextCursor: string | null } = {
      cards: [fakeCard("a"), fakeCard("b")],
      nextCursor: "c2",
    };
    const page2: { cards: HomeProductCard[]; nextCursor: string | null } = {
      cards: [fakeCard("c")],
      nextCursor: null,
    };
    const seq = [page1, page2];
    const loadPage = vi.fn(async () => seq.shift() ?? { cards: [], nextCursor: null });
    render(<LoadMore initialCursor="c1" loadPage={loadPage} />);
    fireEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));
    await waitFor(() => screen.getByRole("button", { name: "تحميل المزيد" }));
    fireEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));
    await waitFor(() => {
      expect(loadPage).toHaveBeenCalledTimes(2);
    });
    const hrefs = Array.from(document.querySelectorAll('a[href^="/p/"]'));
    const ids = hrefs.map((a) => a.getAttribute("href")!.split("/")[2]);
    expect(ids).toEqual(["a", "b", "c"]); // in-order, no repeat, no skip
    expect(new Set(ids).size).toBe(ids.length); // duplicate-free proof
  });
});
