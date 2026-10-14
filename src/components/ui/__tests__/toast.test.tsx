// FE-1 toast tests: kinds, live regions, dismiss, error persistence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "../toast";
import { Button } from "../button";

function Harness() {
  const { notify } = useToast();
  return (
    <div dir="rtl" lang="ar">
      <Button onClick={() => notify("success", "تم الحفظ")}>نجاح</Button>
      <Button onClick={() => notify("error", "فشل الحفظ", "حاول مجددًا")}>خطأ</Button>
    </div>
  );
}

describe("toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces success politely and auto-dismisses", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "نجاح" }));
    expect(screen.getByRole("status")).toHaveTextContent("تم الحفظ");
    act(() => {
      vi.advanceTimersByTime(6500);
    });
    expect(screen.queryByText("تم الحفظ")).not.toBeInTheDocument();
  });

  it("announces errors assertively and keeps them until dismissed", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "خطأ" }));
    expect(screen.getByRole("alert")).toHaveTextContent("فشل الحفظ");
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إغلاق التنبيه" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
