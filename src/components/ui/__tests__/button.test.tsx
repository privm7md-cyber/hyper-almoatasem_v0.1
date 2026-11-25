// FE-1 Button tests (behavioral + semantic, RTL-mirrored render).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "../button";

function rtl(children: React.ReactNode) {
  return render(<div dir="rtl" lang="ar">{children}</div>);
}

describe("Button", () => {
  it("renders primary by default with type=button", () => {
    rtl(<Button>أضف</Button>);
    const btn = screen.getByRole("button", { name: "أضف" });
    expect(btn).toHaveAttribute("type", "button");
  });

  it("supports submit type for forms", () => {
    rtl(<Button type="submit">إرسال</Button>);
    expect(screen.getByRole("button", { name: "إرسال" })).toHaveAttribute("type", "submit");
  });

  it("disables and announces busy while loading", () => {
    rtl(<Button loading>جارٍ</Button>);
    const btn = screen.getByRole("button", { name: "جارٍ" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("does not fire while loading (no duplicate submit)", () => {
    const onClick = vi.fn();
    rtl(
      <Button loading onClick={onClick}>
        جارٍ
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "جارٍ" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has a 44px minimum touch target at md and sm sizes and icon variant", () => {
    rtl(
      <>
        <Button>أضف</Button>
        <Button size="sm">إجراء صغير</Button>
        <Button variant="icon" aria-label="إغلاق">×</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "أضف" })).toHaveClass("min-h-[44px]");
    expect(screen.getByRole("button", { name: "إجراء صغير" })).toHaveClass("min-h-[44px]");
    const iconBtn = screen.getByRole("button", { name: "إغلاق" });
    expect(iconBtn).toHaveClass("min-h-[44px]", "min-w-[44px]");
  });

  it("renders a decorative aria-hidden spinner icon while loading", () => {
    const { container } = rtl(<Button loading>حفظ</Button>);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
