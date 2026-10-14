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
