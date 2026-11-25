// FE-1 states tests: empty ≠ error, retry wiring, busy semantics.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyState, ErrorState, LoadingState, Spinner } from "../states";

describe("states", () => {
  it("EmptyState is not an alert and offers its action", () => {
    render(
      <EmptyState title="سلتك فاضية" hint="ابدأ التسوق" action={<button type="button">تسوق</button>} />,
    );
    expect(screen.getByText("سلتك فاضية")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسوق" })).toBeInTheDocument();
  });

  it("EmptyState announces its title as a real heading", () => {
    // The title IS the heading of the block: a <p> is never announced as a
    // heading and leaves the block out of the document outline.
    render(<EmptyState title="لا توجد نتائج" hint="جرّب بحثًا آخر" />);
    const heading = screen.getByRole("heading", { name: "لا توجد نتائج" });
    expect(heading.tagName).toBe("H2");
    expect(screen.getByText("جرّب بحثًا آخر").tagName).toBe("P");
  });

  it("EmptyState heading level is explicit for a nested block", () => {
    // Inside a section that already owns an <h2>, the empty state must be an
    // <h3> — a sibling <h2> would break the heading order.
    render(
      <section>
        <h2>المخزون</h2>
        <EmptyState title="لا يوجد مخزون" headingLevel={3} />
      </section>,
    );
    expect(screen.getByRole("heading", { name: "لا يوجد مخزون" }).tagName).toBe("H3");
  });

  it("ErrorState announces via alert and retries on demand", () => {
    const onRetry = vi.fn();
    render(<ErrorState text="تعذّر التحميل" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("LoadingState marks busy without claiming content", () => {
    const { container } = render(<LoadingState label="جارٍ التحميل" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "جارٍ التحميل" })).toBeInTheDocument();
  });

  it("Spinner exposes an accessible name", () => {
    render(<Spinner label="جارٍ الحفظ" />);
    expect(screen.getByRole("status", { name: "جارٍ الحفظ" })).toBeInTheDocument();
  });
});
