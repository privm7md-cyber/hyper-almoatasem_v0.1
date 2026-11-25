import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NAV-05: focus must move to <main id="main"> after an SPA route change,
// and must NOT move while a modal dialog owns the focus.

const usePathname = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

import { cleanup, render } from "@testing-library/react";
import {
  RouteFocus,
  resetRouteFocusState,
} from "@/components/store/route-focus";

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
    resetRouteFocusState();
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

  it("moves focus to the new #main even when StoreShell remounts a fresh RouteFocus instance", async () => {
    const firstRender = render(<RouteFocus />);
    await raf();
    firstRender.unmount();

    main.remove();
    const nextMain = document.createElement("main");
    nextMain.id = "main";
    nextMain.tabIndex = -1;
    document.body.appendChild(nextMain);
    const nextFocusSpy = vi.spyOn(nextMain, "focus");

    usePathname.mockReturnValue("/categories");
    render(<RouteFocus />);
    await raf();
    expect(nextFocusSpy).toHaveBeenCalledTimes(1);
  });

  it("re-targets the settled page #main after a transient loading boundary unmounts", async () => {
    const initialRender = render(<RouteFocus />);
    await raf();
    initialRender.unmount();

    // 1. Transient loading.tsx mounts on the target pathname with data-route-loading="true".
    main.innerHTML = '<div data-route-loading="true">جارٍ التحميل…</div>';
    const loadingFocusSpy = vi.spyOn(main, "focus");
    usePathname.mockReturnValue("/categories");
    const loadingRender = render(<RouteFocus />);
    await raf();
    expect(loadingFocusSpy).toHaveBeenCalledTimes(1);

    // 2. Resolved page.tsx replaces <main id="main"> on the same pathname.
    loadingRender.unmount();
    main.remove();
    const settledMain = document.createElement("main");
    settledMain.id = "main";
    settledMain.tabIndex = -1;
    settledMain.textContent = "الأقسام";
    document.body.appendChild(settledMain);
    const settledFocusSpy = vi.spyOn(settledMain, "focus");

    render(<RouteFocus />);
    await raf();
    expect(settledFocusSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves focus if the user moved to a header control during transient loading", async () => {
    const initialRender = render(<RouteFocus />);
    await raf();
    initialRender.unmount();

    main.innerHTML = '<div data-route-loading="true">جارٍ التحميل…</div>';
    usePathname.mockReturnValue("/categories");
    const loadingRender = render(<RouteFocus />);
    await raf();

    const headerButton = document.createElement("button");
    headerButton.type = "button";
    headerButton.textContent = "القائمة";
    document.body.appendChild(headerButton);
    headerButton.focus();

    loadingRender.unmount();
    main.remove();
    const settledMain = document.createElement("main");
    settledMain.id = "main";
    settledMain.tabIndex = -1;
    document.body.appendChild(settledMain);
    const settledFocusSpy = vi.spyOn(settledMain, "focus");

    render(<RouteFocus />);
    await raf();
    expect(settledFocusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(headerButton);
  });

  it("P1208-D04: skips React 19 display:none suspended #main during loading.tsx fallback and focuses settled #main", async () => {
    const initialRender = render(<RouteFocus />);
    await raf();
    initialRender.unmount();

    // React 19 <Suspense> keeps the suspended #main in DOM with display:none ahead of loading.tsx
    main.style.display = "none";
    const suspendedFocusSpy = vi.spyOn(main, "focus");

    const loadingMain = document.createElement("main");
    loadingMain.setAttribute("data-route-loading-main", "true");
    loadingMain.tabIndex = -1;
    loadingMain.innerHTML = '<div data-route-loading="true">جارٍ التحميل…</div>';
    document.body.appendChild(loadingMain);
    const loadingFocusSpy = vi.spyOn(loadingMain, "focus");

    usePathname.mockReturnValue("/brands");
    const loadingRender = render(<RouteFocus />);
    await raf();
    expect(suspendedFocusSpy).not.toHaveBeenCalled();
    expect(loadingFocusSpy).toHaveBeenCalledTimes(1);

    // Settled /brands page unmounts suspended #main and loadingMain, mounting visible <main id="main">
    loadingRender.unmount();
    main.remove();
    loadingMain.remove();
    const settledMain = document.createElement("main");
    settledMain.id = "main";
    settledMain.tabIndex = -1;
    settledMain.textContent = "العلامات التجارية";
    document.body.appendChild(settledMain);
    const settledFocusSpy = vi.spyOn(settledMain, "focus");

    render(<RouteFocus />);
    await raf();
    expect(settledFocusSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(settledMain);
  });
});
