// FE-11 users + roles list tests: gates, read states, denial-before-read.
// Identity AND reads mocked (no DB, no network). Role/user mutations are covered
// by island tests (role-delete) and mocked contracts; live directory writes are
// policy-blocked and remain documented as such.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireAdmin: vi.fn(),
  requirePermission: vi.fn(),
  checkPermission: vi.fn(),
}));

vi.mock("@/lib/admin/queries", () => ({
  listUsers: vi.fn(),
  listRoles: vi.fn(),
}));

// `@/lib/api/serialize` carries `import "server-only"` (backend boundary marker),
// unreachable from vitest/jsdom. Stubbed byte-identical (verified against source);
// domain mapping in `@/lib/admin/serialize` stays real and under test.
vi.mock("@/lib/api/serialize", () => ({
  dec: (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : v.toString()),
  decReq: (v: { toString(): string }) => v.toString(),
  iso: (v: Date | null | undefined) => (v === null || v === undefined ? null : v.toISOString()),
  isoReq: (v: Date) => v.toISOString(),
}));

import AdminUsersPage from "../users/page";
import AdminRolesPage from "../roles/page";
import { requirePermission } from "@/lib/auth/rbac";
import { listRoles, listUsers } from "@/lib/admin/queries";

const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const dt = new Date("2026-10-01T00:00:00Z");

function userRow(i: number) {
  return {
    id: `u-${i}`,
    name: `موظف ${i}`,
    email: `staff${i}@example.com`,
    phone: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: dt,
    updatedAt: dt,
    userRoles: [{ role: { name: "STORE_MANAGER" } }],
  };
}

function roleRow(i: number) {
  return {
    id: `r-${i}`,
    name: `دور ${i}`,
    description: null,
    isActive: true,
    createdAt: dt,
    updatedAt: dt,
  };
}

const sp = (q: Record<string, string>) => Promise.resolve(q);
const ctx = (permissions: string[]) => ({
  user: { id: "u", name: "n", email: "e" },
  roles: [],
  permissions,
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("admin users list (FE-11)", () => {
  it("gates on users.view and renders directory rows with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["users.view"]));
    vi.mocked(listUsers).mockResolvedValue([userRow(1), userRow(2)] as unknown as Awaited<ReturnType<typeof listUsers>>);
    render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("users.view");
    // Name renders alongside email inside one link (text split across elements).
    expect(screen.getByText("staff1@example.com")).toBeVisible();
    expect(document.querySelector('a[href="/admin/users/u-1"]')).not.toBeNull();
  });

  it("shows empty and error states", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["users.view"]));
    vi.mocked(listUsers).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof listUsers>>);
    const { unmount } = render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.getByText("لا يوجد مستخدمون مطابقون")).toBeVisible();
    unmount();
    vi.mocked(listUsers).mockRejectedValueOnce(new Error("DB down"));
    render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.getByText("تعذّر التحميل")).toBeVisible();
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminUsersPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listUsers).not.toHaveBeenCalled();
  });
});

describe("admin roles list (FE-11)", () => {
  it("gates on roles.view and renders role rows with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["roles.view"]));
    vi.mocked(listRoles).mockResolvedValue([roleRow(1)] as unknown as Awaited<ReturnType<typeof listRoles>>);
    render(
      <ToastProvider>{await AdminRolesPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("roles.view");
    expect(screen.getByText("دور 1")).toBeVisible();
    expect(document.querySelector('a[href="/admin/roles/r-1"]')).not.toBeNull();
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminRolesPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(listRoles).not.toHaveBeenCalled();
  });
});
