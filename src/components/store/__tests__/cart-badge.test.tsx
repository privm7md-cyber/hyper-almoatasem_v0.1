// P12-02 CartBadge confirmed-change pulse tests (jsdom, fake timers).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CartBadge, notifyCartCount } from "../cart-badge";
import { MOTION_DURATIONS_MS } from "@/lib/motion-tokens";

afterEach(() => {
  cleanup();
  notifyCartCount(0);
  vi.useRealTimers();
});

describe("CartBadge motion feedback", () => {
  it("does not pulse on initial mount when count is already present", () => {
    notifyCartCount(2);
    render(<CartBadge />);
    const badge = screen.getByTestId("cart-badge");
    expect(badge).toHaveTextContent("2");
    expect(badge).not.toHaveAttribute("data-cart-pulse");
  });

  it("pulses briefly on confirmed cart count change and settles automatically", () => {
    vi.useFakeTimers();
    notifyCartCount(1);
    render(<CartBadge />);
    const badge = screen.getByTestId("cart-badge");
    expect(badge).not.toHaveAttribute("data-cart-pulse");

    act(() => {
      notifyCartCount(3);
    });
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveAttribute("data-cart-pulse", "true");

    act(() => {
      vi.advanceTimersByTime(MOTION_DURATIONS_MS.short + 10);
    });
    expect(badge).not.toHaveAttribute("data-cart-pulse");
  });

  it("does not re-trigger pulse on unrelated rerender with unchanged count", () => {
    notifyCartCount(4);
    const { rerender } = render(<CartBadge />);
    const badge = screen.getByTestId("cart-badge");
    expect(badge).not.toHaveAttribute("data-cart-pulse");
    rerender(<CartBadge />);
    expect(badge).not.toHaveAttribute("data-cart-pulse");
  });

  it("transitions to empty screen-reader notice when count returns to zero", () => {
    notifyCartCount(1);
    render(<CartBadge />);
    expect(screen.getByTestId("cart-badge")).toBeInTheDocument();
    act(() => {
      notifyCartCount(0);
    });
    expect(screen.queryByTestId("cart-badge")).toBeNull();
    expect(screen.getByText("السلة فارغة")).toBeInTheDocument();
  });
});
