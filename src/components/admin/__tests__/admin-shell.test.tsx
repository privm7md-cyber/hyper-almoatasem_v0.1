// DOM/unit coverage only: no services, database, auth or browser navigation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react";

const runtime = vi.hoisted(() => ({
  pathname: "/admin",
  search: "",
  searchBlock:null as Promise<void>|null,
  mobile: false,
  loads: 0,
  listeners: new Set<() => void>(),
  logout: vi.fn(),
  expectedLogouts: 0,
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => runtime.pathname,
  useSearchParams: () => {if(runtime.searchBlock)throw runtime.searchBlock;return new URLSearchParams(runtime.search);},
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/actions/auth", () => ({ logoutAction: runtime.logout }));
vi.mock("next/link", () => ({
  default: ({ href, onNavigate, onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; onNavigate?: () => void }) => (
    <a href={href} {...props} onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        onNavigate?.();
      }
    }}>{children}</a>
  ),
}));
vi.mock("next/dynamic", async () => {
  const { lazy, Suspense } = await import("react");
  return {
    default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
      const Component = lazy(async () => {
        runtime.loads += 1;
        return { default: await loader() };
      });
      return function DynamicTestComponent(props: Record<string, unknown>) {
        return <Suspense fallback={null}><Component {...props} /></Suspense>;
      };
    },
  };
});

import { ADMIN_THEME_STORAGE_KEY, AdminShell } from "../admin-shell";
import { ADMIN_NAV_GROUPS, permittedNavGroups } from "../nav-config";
import AdminError from "@/app/admin/error";

const permissions = [...new Set(ADMIN_NAV_GROUPS.flatMap((group) => group.items.flatMap((item) => item.perm ? [item.perm] : [])))];
const groups = permittedNavGroups(ADMIN_NAV_GROUPS, permissions);
const user = { name: "Jane Doe", email: "jane@example.test", roles: ["STORE_ADMIN"] };
const shell = (props: { unreadCount?: number | null; canSearchProducts?: boolean; children?: ReactNode } = {}) => (
  <AdminShell groups={groups} user={user} {...props}>{props.children ?? <button type="button">محتوى الصفحة</button>}</AdminShell>
);

beforeEach(() => {
  runtime.pathname = "/admin";
  runtime.search = "";
  runtime.searchBlock=null;
  runtime.mobile = false;
  runtime.listeners.clear();
  runtime.logout.mockClear();
  runtime.expectedLogouts = 0;
  runtime.fetch.mockClear();
  vi.stubGlobal("fetch", runtime.fetch);
  window.localStorage.clear();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query.includes("prefers-reduced-motion") || (query.includes("max-width: 1023px") && runtime.mobile),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      if (query.includes("max-width: 1023px")) runtime.listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => runtime.listeners.delete(listener)),
    dispatchEvent: () => true,
  }));
});

afterEach(() => {
  // Reset volatile fallback while the store still has subscribers.
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: ADMIN_THEME_STORAGE_KEY })));
  cleanup();
  // Only the explicit logout submission test may call the isolated action mock.
  expect(runtime.logout).toHaveBeenCalledTimes(runtime.expectedLogouts);
  expect(runtime.fetch).not.toHaveBeenCalled();
  document.querySelectorAll("[data-shell-test]").forEach((node) => node.remove());
  document.body.style.overflow = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ADM-01 shell", () => {
  it("never mounts page children in the Suspense fallback and preserves focus after resuming",async()=>{
    let release!:()=>void;
    runtime.searchBlock=new Promise<void>(resolve=>{release=resolve;});
    const view=render(shell());
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ تجهيز");
    expect(screen.queryByRole("button",{name:"محتوى الصفحة"})).not.toBeInTheDocument();
    expect(view.container.querySelectorAll("main")).toHaveLength(0);
    await act(async()=>{runtime.searchBlock=null;release();});
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const pageButton=screen.getByRole("button",{name:"محتوى الصفحة"});pageButton.focus();
    runtime.searchBlock=new Promise<void>(resolve=>{release=resolve;});
    view.rerender(shell());
    expect(view.container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.queryAllByRole("button",{name:"محتوى الصفحة"})).toHaveLength(0);
    await act(async()=>{runtime.searchBlock=null;release();});
    expect(screen.getAllByRole("button",{name:"محتوى الصفحة"})).toHaveLength(1);
    expect(pageButton).toHaveFocus();
  });
  it("renders account name, role, skip link and honest unknown count without desktop Motion", () => {
    const { container } = render(shell());
    expect(runtime.loads).toBe(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Jane Doe")).toHaveLength(2);
    expect(screen.getByLabelText("الحساب الحالي")).toHaveTextContent("مدير المتجر");
    expect(screen.getByRole("link", { name: "تخطي إلى المحتوى" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: "إشعاراتي: عدد غير المقروء غير معروف" })).toHaveAttribute("href", "/admin/notifications");
    expect(container.querySelector(".adm-notification-count")).toHaveTextContent("—");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "light");
  });

  it.each([0, 12])("shows the supplied unread count honestly: %s", (count) => {
    render(shell({ unreadCount: count }));
    expect(screen.getByRole("link", { name: `إشعاراتي: ${count} غير مقروء` })).toHaveTextContent(String(count));
  });

  it.each([-1, NaN, 1.5])("does not manufacture a valid unread count from %s", (count) => {
    render(shell({ unreadCount: count }));
    expect(screen.getByRole("link", { name: /عدد غير المقروء غير معروف/ })).toHaveTextContent("—");
  });

  it("submits a products-only GET using the page's search parameter, not q", () => {
    runtime.pathname = "/admin/products";
    runtime.search = "state=hidden&search=milk";
    render(shell({ canSearchProducts: true }));
    const form = screen.getByRole("search", { name: "البحث في المنتجات فقط" });
    const input = screen.getByRole("searchbox", { name: "بحث المنتجات" });
    expect(form).toHaveAttribute("action", "/admin/products");
    expect(form).toHaveAttribute("method", "get");
    expect(input).toHaveAttribute("name", "search");
    expect(input).toHaveAttribute("maxlength", "160");
    expect(input).toHaveValue("milk");
    fireEvent.change(input, { target: { value: "حليب" } });
    expect(new URLSearchParams(new FormData(form as HTMLFormElement) as unknown as Record<string, string>).toString()).toBe("search=%D8%AD%D9%84%D9%8A%D8%A8");
    expect(screen.getByRole("button", { name: "ابحث في المنتجات" })).toHaveAttribute("type", "submit");
    expect(screen.queryByText(/بحث شامل|البحث في كل/)).not.toBeInTheDocument();
  });

  it.each(["displayed", "hidden", "archived"])("has exactly one current product link for %s", (state) => {
    runtime.pathname = "/admin/products";
    runtime.search = `search=milk&state=${state}`;
    render(shell());
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    expect(nav.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(nav.querySelector('a[aria-current="page"]')).toHaveAttribute("href", `/admin/products?state=${state}`);
  });

  it("collapses groups with real buttons and reopens them on route changes", () => {
    const view = render(shell());
    const toggle = screen.getByRole("button", { name: "المنتجات والمخزون" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
    runtime.pathname = "/admin/products/id";
    view.rerender(shell());
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const breadcrumbs = screen.getByRole("navigation", { name: "مسار الصفحة" });
    expect(within(breadcrumbs).getByRole("link", { name: "كل المنتجات" })).toHaveAttribute("href", "/admin/products");
    expect(breadcrumbs).toHaveTextContent("تفاصيل المنتج");
    expect(breadcrumbs).not.toHaveTextContent("/id");
  });

  it("does not falsely assert a failed page could not have changed data", () => {
    const reset = vi.fn();
    render(shell({ children: <AdminError reset={reset} /> }));
    expect(screen.getByRole("alert")).toHaveTextContent("راجع حالته قبل تكراره");
    expect(screen.getByRole("alert")).not.toHaveTextContent("مفيش بيانات اتغيرت");
    fireEvent.click(screen.getByRole("button", { name: "جرّب تاني" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("isolated hydration-safe admin theme", () => {
  it("toggles, persists and restores the preference without changing the document or storefront", () => {
    window.localStorage.setItem("theme", "dark");
    const rootTheme = document.documentElement.getAttribute("data-theme");
    const view = render(shell());
    const toggle = screen.getByRole("button", { name: /مظهر مساحة العمل: فاتح/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /مظهر مساحة العمل: داكن/ })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "dark");
    expect(window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe(rootTheme);
    view.unmount();
    const restored = render(shell());
    expect(restored.container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "dark");
    fireEvent.click(screen.getByRole("button", { name: /مظهر مساحة العمل: داكن/ }));
    expect(window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).toBe("light");
  });

  it("hydrates light server markup before adopting a saved dark preference", async () => {
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, "dark");
    const container = document.createElement("div");
    container.dataset.shellTest = "hydration";
    document.body.append(container);
    container.innerHTML = renderToString(shell());
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "light");
    const recover = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, shell(), { onRecoverableError: recover }); });
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "dark");
    expect(recover).not.toHaveBeenCalled();
    act(() => root!.unmount());
  });

  it("accepts same-origin preference changes from other tabs, with safe invalid defaults", () => {
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, "invalid");
    const { container } = render(shell());
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "light");
    act(() => {
      window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: ADMIN_THEME_STORAGE_KEY }));
    });
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "dark");
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "light");
  });

  it("keeps toggling usable when browser storage access is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { container } = render(shell());
    fireEvent.click(screen.getByRole("button", { name: /مظهر مساحة العمل: فاتح/ }));
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "dark");
    fireEvent.click(screen.getByRole("button", { name: /مظهر مساحة العمل: داكن/ }));
    expect(container.querySelector(".adm-shell")).toHaveAttribute("data-adm-theme", "light");
  });
});

describe("mobile drawer keyboard lifecycle (real reduced-motion overlay)", () => {
  async function openDrawer() {
    runtime.mobile = true;
    const view = render(shell());
    const trigger = screen.getByRole("button", { name: "الأقسام" });
    trigger.focus();
    await act(async () => {
      fireEvent.click(trigger);
      await import("@/components/admin/ui/motion-kit");
    });
    const dialog = await screen.findByRole("dialog", { name: "أقسام لوحة الإدارة" });
    return { view, trigger, dialog };
  }

  it("traps focus, excludes collapsed links, makes the background inert and restores focus on Escape", async () => {
    const outside = document.createElement("button");
    outside.dataset.shellTest = "outside";
    document.body.append(outside);
    document.body.style.overflow = "clip";
    const { trigger, dialog, view } = await openDrawer();
    const close = within(dialog).getByRole("button", { name: "إغلاق القائمة" });
    expect(close).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(view.container.querySelector(".adm-shell-background")).toHaveAttribute("inert");
    expect(outside).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    const logout = within(dialog).getByRole("button", { name: "خروج" });
    logout.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(logout).toHaveFocus();
    const systemToggle = within(dialog).getByRole("button", { name: "إدارة النظام" });
    fireEvent.click(systemToggle);
    // A disabled submit control and collapsed links must leave the group's
    // keyboard button as the final focusable target.
    (logout as HTMLButtonElement).disabled = true;
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(systemToggle).toHaveFocus();
    (logout as HTMLButtonElement).disabled = false;
    outside.focus();
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(view.container.querySelector(".adm-shell-background")).not.toHaveAttribute("inert");
    expect(outside).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("clip");
  });

  it("keeps desktop logout and offers the same submit action inside mobile navigation", async () => {
    const { view, dialog } = await openDrawer();
    const desktopLogout = within(view.container.querySelector(".adm-rail") as HTMLElement).getByRole("button", { name: "خروج" });
    const mobileLogout = within(dialog).getByRole("button", { name: "خروج" });
    expect(desktopLogout).toHaveAttribute("type", "submit");
    expect(desktopLogout.closest("form")).not.toBeNull();
    expect(mobileLogout).toHaveAttribute("type", "submit");
    expect(mobileLogout.closest("form")).not.toBeNull();
    expect(mobileLogout.tabIndex).toBe(0);
    mobileLogout.focus();
    expect(mobileLogout).toHaveFocus();
    // React submits only to the module-isolated mock: never to real auth.
    runtime.expectedLogouts = 1;
    await act(async () => { fireEvent.submit(mobileLogout.closest("form")!); });
    await waitFor(() => expect(runtime.logout).toHaveBeenCalledOnce());
    expect(runtime.logout.mock.calls[0][0]).toBeInstanceOf(FormData);
  });

  it.each(["pathname", "search"] as const)("closes on %s changes and stays closed when going back", async (field) => {
    const { view, trigger } = await openDrawer();
    runtime[field] = field === "pathname" ? "/admin/orders/id" : "state=hidden";
    view.rerender(shell());
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(document.body.style.overflow).toBe("");
    });
    runtime[field] = field === "pathname" ? "/admin" : "";
    view.rerender(shell());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on navigation and on desktop breakpoint changes, restoring prior inert state", async () => {
    const prior = document.createElement("div");
    prior.dataset.shellTest = "previous-inert";
    prior.setAttribute("inert", "saved");
    document.body.append(prior);
    const { trigger, dialog } = await openDrawer();
    fireEvent.click(within(dialog).getByRole("link", { name: /^الطلبات/ }));
    // The focus restoration happens in the close effect, so it is awaited
    // together with the removal of the dialog (same as the other cases).
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(prior).toHaveAttribute("inert", "saved");
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    act(() => {
      runtime.mobile = false;
      for (const notify of runtime.listeners) notify();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).toBe("");
    expect(prior).toHaveAttribute("inert", "saved");
  });
});

describe("scoped admin palette and accessibility rules", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/admin/admin.css"), "utf8");
  it("scopes preferences, declares keyboard focus and reduced-motion rules", () => {
    expect(css).not.toMatch(/:root\s*\{/);
    expect(css).toContain('.adm-shell[data-adm-theme="dark"]');
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain(".adm-skip-link:focus");
    expect(css).toContain("outline: 3px solid var(--adm-focus)");
    expect(css).toMatch(/\.adm-btn--sm\s*\{\s*min-height: 44px/);
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("transition-duration: 0s !important");
    expect(css).toContain(".adm-drawer.adm-nav-drawer");
    expect(css).toContain(".adm-shell .adm-rail :is(a, button):focus-visible");
  });

  it("keeps core workspace, status and rail text above WCAG AA contrast in both themes", () => {
    const tokens = (block: string) => Object.fromEntries(
      [...block.matchAll(/(--adm-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]),
    );
    const light = tokens(css.match(/\.adm-shell\s*\{([\s\S]*?)\}/)![1]);
    const dark = { ...light, ...tokens(css.match(/\.adm-shell\[data-adm-theme="dark"\]\s*\{([\s\S]*?)\}/)![1]) };
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map((start) => {
        const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const ratio = (palette: Record<string, string>, foreground: string, background: string) => {
      const a = luminance(palette[`--adm-${foreground}`]);
      const b = luminance(palette[`--adm-${background}`]);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const textPairs = [
      ["ink", "canvas"], ["ink-2", "surface"], ["ink-3", "input-bg"],
      ["on-accent", "accent"], ["on-accent", "accent-hi"], ["on-danger", "danger"],
      ["accent-ink", "accent-soft"], ["warn-ink", "warn-soft"], ["danger-ink", "danger-soft"], ["info-ink", "info-soft"],
      ["rail-ink", "rail"], ["rail-ink-2", "rail-2"],
    ];
    for (const palette of [light, dark]) {
      for (const [foreground, background] of textPairs) {
        expect(ratio(palette, foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(palette, "focus", "surface")).toBeGreaterThanOrEqual(3);
      expect(ratio(palette, "accent-on-dark", "rail")).toBeGreaterThanOrEqual(3);
    }
  });
});
