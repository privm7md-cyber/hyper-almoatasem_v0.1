// P08-T02: the search box is gated by the CONTRACT (q 2..120 after trim) — the
// app-level note carries the exact mandated text (role="alert", error
// announcement convention) and navigation happens ONLY for a contract-valid
// query. jsdom runs no native constraint validation; the native minLength
// attribute was REMOVED in this phase so real browsers follow this same
// app-gated path instead of a browser bubble.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchBox } from "../search-box";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("SearchBox submit gating (P08-T02 matrix)", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("1 char: shows the mandated minimum message, never navigates", () => {
    render(<SearchBox />);
    fireEvent.change(screen.getByLabelText("ابحث عن منتج"), { target: { value: "ا" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(screen.getByRole("alert")).toHaveTextContent("اكتب حرفين على الأقل للبحث");
    expect(push).not.toHaveBeenCalled();
  });

  it("0 chars (spaces only): no invalid send, no navigation", () => {
    render(<SearchBox />);
    fireEvent.change(screen.getByLabelText("ابحث عن منتج"), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(screen.getByRole("alert")).toHaveTextContent("اكتب حرفين على الأقل للبحث");
    expect(push).not.toHaveBeenCalled();
  });

  it("2+ chars: navigates with the encoded Arabic query and clears the note", () => {
    render(<SearchBox />);
    fireEvent.change(screen.getByLabelText("ابحث عن منتج"), { target: { value: "أرز بسمتي" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent("أرز بسمتي")}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the note clears as soon as the user edits again (no stale error)", () => {
    render(<SearchBox />);
    fireEvent.change(screen.getByLabelText("ابحث عن منتج"), { target: { value: "ا" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ابحث عن منتج"), { target: { value: "اا" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
