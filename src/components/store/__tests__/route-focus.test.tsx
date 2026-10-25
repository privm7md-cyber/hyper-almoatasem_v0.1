import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NAV-05: focus must move to <main id="main"> after an SPA route change,
// and must NOT move while a modal dialog owns the focus.

const usePathname = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

import { cleanup, render } from "@testing-library/react";
import { RouteFocus } from "@/components/store/route-focus";

const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe("RouteFocus", () => {
  let main: HTMLElement;

  beforeEach(() => {
    usePathname.mockReturnValue("/");
    main = document.createElement("main");
    main.id = "main";
    main.tabIndex = -1;
    document.body.appendChild(main);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("does not steal focus on first mount (full page load keeps browser flow)", () => {
    const focusSpy = vi.spyOn(main, "focus");
    render(<RouteFocus />);
    return raf().then(() => {
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  it("moves focus to #main when the path changes", async () => {
    const { rerender } = render(<RouteFocus />);
    const focusSpy = vi.spyOn(main, "focus");
    usePathname.mockReturnValue("/categories");
    rerender(<RouteFocus />);
    await raf();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("keeps focus inside an open modal dialog instead of jumping to main", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    const { rerender } = render(<RouteFocus />);
    const focusSpy = vi.spyOn(main, "focus");
    usePathname.mockReturnValue("/cart");
    rerender(<RouteFocus />);
    await raf();
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
