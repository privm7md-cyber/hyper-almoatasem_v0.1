// Client chrome only: server-rendered page content and permission-filtered
// navigation arrive as props. The only lazy Motion surface here is mobile nav.
"use client";

import { Suspense, useCallback, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Bell, ChevronDown, LogOut, Menu, Moon, Search, Sun } from "lucide-react";
import { adminBreadcrumbs, isAdminNavActive, type AdminIconName } from "@/components/admin/nav-config";
import { navIcon } from "@/components/admin/nav-icons";
import { operatorDisplayName, roleLabel } from "@/lib/admin/terminology";
import { logoutAction } from "@/app/actions/auth";

const MotionNavOverlay = dynamic(
  () => import("@/components/admin/ui/motion-kit").then((mod) => mod.MotionNavOverlay),
  { ssr: false },
);

export interface ShellNavItem {
  href: string;
  label: string;
  hint: string;
  icon: AdminIconName;
}

export interface ShellNavGroup {
  title: string;
  items: ShellNavItem[];
}

export interface ShellUser {
  name: string;
  email: string;
  roles: string[];
}

interface AdminShellProps {
  groups: ShellNavGroup[];
  user: ShellUser;
  unreadCount?: number | null;
  canSearchProducts?: boolean;
  children: ReactNode;
}

// Isolated from storefront preferences; SSR always uses the hybrid light
// workspace. useSyncExternalStore adopts saved preferences after hydration.
export const ADMIN_THEME_STORAGE_KEY = "hyper-admin-workspace-theme";
const THEME_EVENT = "admin-workspace-theme-change";
type AdminTheme = "light" | "dark";
let volatileTheme: AdminTheme | null = null;

function themeSnapshot(): AdminTheme {
  if (volatileTheme) return volatileTheme;
  try {
    return window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function subscribeTheme(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ADMIN_THEME_STORAGE_KEY || event.key === null) {
      volatileTheme = null;
      notify();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_EVENT, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_EVENT, notify);
  };
}

function changeTheme(theme: AdminTheme) {
  try {
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, theme);
    volatileTheme = null;
  } catch {
    // Restricted/private storage must not make the control inoperable.
    volatileTheme = theme;
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

const lightSnapshot = (): AdminTheme => "light";
const desktopSnapshot = () => false;
const MOBILE_QUERY = "(max-width: 1023px)";
const mobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
function subscribeViewport(notify: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function ShellNavSection({
  group,
  pathname,
  search,
  routeKey,
  variant,
  onNavigate,
}: {
  group: ShellNavGroup;
  pathname: string;
  search: string;
  routeKey: string;
  variant: "rail" | "drawer";
  onNavigate: () => void;
}) {
  const listId = useId();
  const [collapsedAt, setCollapsedAt] = useState<string | null>(null);
  // A new URL reopens the section, including when arriving at a detail page.
  if (collapsedAt !== null && collapsedAt !== routeKey) setCollapsedAt(null);
  const expanded = collapsedAt !== routeKey;
  return (
    <section className="adm-rail-group">
      <button
        type="button"
        className="adm-rail-group-toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setCollapsedAt(expanded ? routeKey : null)}
      >
        <span>{group.title}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={listId} hidden={!expanded} className="adm-rail-group-links">
        {group.items.map((item) => {
          const Icon = navIcon(item.icon);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isAdminNavActive(item.href, pathname, search) ? "page" : undefined}
              title={item.hint}
              className={`adm-rail-link${variant === "drawer" ? " adm-rail-link--drawer" : ""}`}
              onNavigate={onNavigate}
            >
              <span className="adm-rail-link-row">
                <span className="adm-rail-link-icon"><Icon size={18} aria-hidden="true" /></span>
                <span>{item.label}</span>
              </span>
              {variant === "drawer" ? <span className="adm-rail-link-hint">{item.hint}</span> : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function RouteAwareShell({ groups, user, children, unreadCount = null, canSearchProducts = false }: AdminShellProps) {
  const pathname = usePathname() ?? "/admin";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const routeKey = `${pathname}?${search}`;
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, lightSnapshot);
  const narrow = useSyncExternalStore(subscribeViewport, mobileSnapshot, desktopSnapshot);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  // Guarded render-time reset, not an effect: back navigation cannot reopen a
  // stale drawer, and query-only navigation closes it just like a path change.
  if (openedAt !== null && (openedAt !== routeKey || !narrow)) setOpenedAt(null);
  const drawerOpen = narrow && openedAt === routeKey;
  const panelId = useId();
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const crumbs = adminBreadcrumbs(pathname, search);
  const name = operatorDisplayName(user.name, user.roles);
  const roles = [...new Set(user.roles.map(roleLabel))].join("، ") || "بدون دور";
  const count = typeof unreadCount === "number" && Number.isInteger(unreadCount) && unreadCount >= 0 ? unreadCount : null;
  const notificationLabel = count === null
    ? "إشعاراتي: عدد غير المقروء غير معروف"
    : `إشعاراتي: ${count} غير مقروء`;
  const closeDrawer = useCallback(() => setOpenedAt(null), []);
  const navLinks = (variant: "rail" | "drawer") => groups.map((group) => (
    <ShellNavSection key={group.title} group={group} pathname={pathname} search={search} routeKey={routeKey} variant={variant} onNavigate={closeDrawer} />
  ));

  return (
    <div className="adm-shell" dir="rtl" data-adm-theme={theme}>
      <div ref={backgroundRef} className="adm-shell-background">
        <a className="adm-skip-link" href="#main">تخطي إلى المحتوى</a>
        <div className="adm-frame">
          <aside className="adm-rail" aria-label="أقسام لوحة الإدارة">
            <div className="adm-rail-brand">
              <span className="adm-rail-mark" aria-hidden="true">ها</span>
              <span className="adm-rail-brand-text">
                <span className="adm-rail-brand-name">هايبر المعتصم</span>
                <span className="adm-rail-brand-role">لوحة الإدارة</span>
              </span>
            </div>
            <nav className="adm-rail-nav" aria-label="التنقل الرئيسي">{navLinks("rail")}</nav>
            <div className="adm-rail-foot">
              <div className="adm-rail-user">
                <bdi className="adm-rail-user-name">{name}</bdi>
                <span className="adm-rail-user-mail" dir="ltr">{user.email}</span>
                <span className="adm-rail-user-roles">{roles}</span>
              </div>
              <form action={logoutAction}>
                <button type="submit" className="adm-btn adm-btn--secondary adm-rail-logout">
                  <LogOut size={16} aria-hidden="true" />خروج
                </button>
              </form>
            </div>
          </aside>
          <div className="adm-body">
            <header className="adm-topbar">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpenedAt(routeKey)}
                aria-expanded={drawerOpen}
                aria-controls={panelId}
                aria-haspopup="dialog"
                className="adm-rail-trigger"
              >
                <Menu size={18} aria-hidden="true" />الأقسام
              </button>
              <div className="adm-topbar-context">
                <span className="adm-topbar-kicker">لوحة الإدارة</span>
                <nav aria-label="مسار الصفحة" className="adm-breadcrumbs">
                  <ol>
                    {crumbs.map((crumb, index) => (
                      <li key={`${index}-${crumb.label}`}>
                        {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
                      </li>
                    ))}
                  </ol>
                </nav>
              </div>
              <div className="adm-topbar-actions">
                <Link href="/admin/notifications" className="adm-topbar-control adm-notifications" aria-label={notificationLabel} title={notificationLabel}>
                  <Bell size={19} aria-hidden="true" />
                  <span className="adm-notification-count" aria-hidden="true">{count === null ? "—" : count}</span>
                </Link>
                <button
                  type="button"
                  className="adm-topbar-control adm-theme-toggle"
                  aria-pressed={theme === "dark"}
                  aria-label={`مظهر مساحة العمل: ${theme === "dark" ? "داكن" : "فاتح"}. تفعيل المظهر ${theme === "dark" ? "الفاتح" : "الداكن"}`}
                  onClick={() => changeTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
                  <span>{theme === "dark" ? "داكن" : "فاتح"}</span>
                </button>
              </div>
              <div className="adm-topbar-user" aria-label="الحساب الحالي">
                <bdi className="adm-topbar-user-name">{name}</bdi>
                <span className="adm-topbar-user-roles">{roles}</span>
              </div>
              {canSearchProducts ? (
                <form action="/admin/products" method="get" role="search" aria-label="البحث في المنتجات فقط" className="adm-product-search">
                  <label htmlFor={searchId} className="adm-sr-only">بحث المنتجات</label>
                  <div className="adm-product-search-fields">
                    <input
                      key={routeKey}
                      id={searchId}
                      name="search"
                      type="search"
                      className="adm-input"
                      placeholder="اسم المنتج أو الكود"
                      maxLength={160}
                      defaultValue={pathname === "/admin/products" ? searchParams?.get("search") ?? "" : ""}
                    />
                    <button type="submit" className="adm-topbar-control" aria-label="ابحث في المنتجات"><Search size={19} aria-hidden="true" /></button>
                  </div>
                </form>
              ) : null}
            </header>
            <main id="main" tabIndex={-1} className="adm-main">
              <div className="adm-main-inner">{children}</div>
            </main>
          </div>
        </div>
      </div>
      {narrow ? (
        <MotionNavOverlay open={drawerOpen} panelId={panelId} onClose={closeDrawer} backgroundRef={backgroundRef} restoreFocusRef={triggerRef}>
          <nav className="adm-rail-nav adm-rail-nav--drawer" aria-label="التنقل الرئيسي">{navLinks("drawer")}</nav>
          <form action={logoutAction}>
            <button type="submit" className="adm-btn adm-btn--secondary adm-rail-logout">
              <LogOut size={16} aria-hidden="true" />خروج
            </button>
          </form>
        </MotionNavOverlay>
      ) : null}
    </div>
  );
}

export function AdminShell(props: AdminShellProps) {
  // The page tree has exactly one owner. Rendering children again in a
  // fallback can mount the same server stream/islands twice during suspension.
  // Keep the loading status separate from both the page and its main landmark.
  return (
    <Suspense fallback={
      <div className="adm-shell" dir="rtl">
        <div className="adm-main"><div className="adm-main-inner" role="status" aria-busy="true">جارٍ تجهيز مساحة الإدارة…</div></div>
      </div>
    }>
      <RouteAwareShell {...props} />
    </Suspense>
  );
}
