// Phase-11 store mobile menu tests (jsdom, no network).
//
// The drawer must be a REAL dialog: it opens, it closes (Escape / close button /
// backdrop), the focus moves into it and returns to the trigger, the background
// does not scroll behind it, and every destination is an existing route.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StoreMenu } from "../store-menu";

const push = vi.fn();
let pathname = "/";

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
  usePathname: () => pathname,
}));

afterEach(() => {
  pathname = "/";
  document.body.style.overflow = "";
});

describe("store mobile menu (Phase-11)", () => {
  it("starts closed and exposes a labelled trigger", () => {
    render(<StoreMenu />);
    const trigger = screen.getByRole("button", { name: "فتح قائمة المتجر" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a modal dialog with the real destinations", () => {
    render(<StoreMenu />);
    fireEvent.click(screen.getByRole("button", { name: "فتح قائمة المتجر" }));
    const dialog = screen.getByRole("dialog", { name: "قائمة المتجر" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const href of [
      "/",
      "/categories",
      "/brands",
      "/search",
      "/cart",
      "/account",
      "/orders",
      "/about",
      "/faq",
      "/delivery",
      "/cancellation",
      "/replacement",
      "/order-help",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("closes on Escape and returns the focus to the trigger", () => {
    render(<StoreMenu />);
    const trigger = screen.getByRole("button", { name: "فتح قائمة المتجر" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("locks the background scroll while open and restores it after", () => {
    render(<StoreMenu />);
    fireEvent.click(screen.getByRole("button", { name: "فتح قائمة المتجر" }));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes when a destination is chosen", () => {
    render(<StoreMenu />);
    fireEvent.click(screen.getByRole("button", { name: "فتح قائمة المتجر" }));
    fireEvent.click(screen.getByRole("link", { name: "الأقسام" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes by itself when the route changes (browser back/forward)", () => {
    const { rerender } = render(<StoreMenu />);
    fireEvent.click(screen.getByRole("button", { name: "فتح قائمة المتجر" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pathname = "/cart";
    rerender(<StoreMenu />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
