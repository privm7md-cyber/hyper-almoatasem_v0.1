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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

// The users list reads one page straight from the database (server-side search,
// server-side keyset pagination). The client never sees the whole table.
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    // The roles list reads its own page from the database: the shared query
    // helper orders by a random id and never drops soft-deleted roles.
    role: {
      findMany: vi.fn(),
    },
  },
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
import { prisma } from "@/lib/db";

const FORBIDDEN = Object.assign(new Error("NEXT_FORBIDDEN"), { digest: "NEXT_FORBIDDEN" });
const dt = new Date("2026-10-01T00:00:00Z");

/** UUID-shaped ids: the keyset cursor is minted from the last kept row. */
function userId(i: number) {
  return `00000000-0000-7000-8000-${String(i).padStart(12, "0")}`;
}

function userRow(i: number) {
  return {
    id: userId(i),
    name: `موظف ${i}`,
    email: `staff${i}@example.com`,
    phone: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: dt,
    updatedAt: dt,
    userRoles: [{ role: { name: "STORE_MANAGER", isActive: true } }],
  };
}

function roleRow(i: number, name = `دور ${i}`) {
  return {
    id: `r-${i}`,
    name,
    description: null,
    isActive: true,
    createdAt: dt,
    updatedAt: dt,
    _count: { rolePermissions: 3, userRoles: 2 },
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
  it("gates on users.view and renders team rows with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["users.view"]));
    vi.mocked(prisma.user.findMany).mockResolvedValue([userRow(1), userRow(2)] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(2);
    render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("users.view");
    // Email renders in its own cell, next to the linked name.
    expect(screen.getByText("staff1@example.com")).toBeVisible();
    expect(document.querySelector(`a[href="/admin/users/${userId(1)}"]`)).not.toBeNull();
  });

  it("never prints the raw role key — the Arabic label is what the operator reads", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["users.view"]));
    vi.mocked(prisma.user.findMany).mockResolvedValue([userRow(1)] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.queryByText("STORE_MANAGER")).toBeNull();
    expect(screen.getByText("دور مخصص")).toBeVisible();
  });

  it("filters and pages on the server: one page, newest first, cursor from the last kept row", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["users.view"]));
    const many = Array.from({ length: 21 }, (_, index) => userRow(index + 1));
    vi.mocked(prisma.user.findMany).mockResolvedValue(many as never);
    vi.mocked(prisma.user.count).mockResolvedValue(21);
    render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({ search: "موظف" }) })}</ToastProvider>,
    );

    const call = vi.mocked(prisma.user.findMany).mock.calls[0][0];
    expect(call?.take).toBe(21);
    expect(call?.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    // The search runs in the query, never in the browser.
    expect(JSON.stringify(call?.where)).toContain("موظف");

    const nextLink = document.querySelector('a[href*="/admin/users?"][href*="cursor="]');
    expect(nextLink).not.toBeNull();
    const cursor = new URL(nextLink?.getAttribute("href") ?? "", "http://admin").searchParams.get("cursor");
    const decoded = JSON.parse(Buffer.from(cursor ?? "", "base64url").toString("utf8"));
    // Row 21 stays on the next page: the cursor points at the last row shown.
    expect(decoded.id).toBe(userId(20));
  });

  it("shows empty and error states", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["users.view"]));
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    const { unmount } = render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.getByText("مفيش حسابات مطابقة للفلترة دي.")).toBeVisible();
    unmount();
    vi.mocked(prisma.user.findMany).mockRejectedValueOnce(new Error("DB down"));
    render(
      <ToastProvider>{await AdminUsersPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.getByText("مفيش تحميل للقائمة")).toBeVisible();
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminUsersPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe("admin roles list (FE-11)", () => {
  it("gates on roles.view and renders role rows with detail links", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["roles.view"]));
    vi.mocked(prisma.role.findMany).mockResolvedValue([roleRow(1)] as never);
    render(
      <ToastProvider>{await AdminRolesPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(requirePermission).toHaveBeenCalledWith("roles.view");
    expect(screen.getByText("دور 1")).toBeVisible();
    expect(document.querySelector('a[href="/admin/roles/r-1"]')).not.toBeNull();
  });

  it("never prints the raw role key — the Arabic label is what the operator reads", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["roles.view"]));
    vi.mocked(prisma.role.findMany).mockResolvedValue([roleRow(1, "SUPER_ADMIN")] as never);
    render(
      <ToastProvider>{await AdminRolesPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    expect(screen.queryByText("SUPER_ADMIN")).toBeNull();
    expect(screen.getByText("مالك المتجر")).toBeVisible();
  });

  it("keeps soft-deleted roles out of the table and pages on the server", async () => {
    vi.mocked(requirePermission).mockResolvedValue(ctx(["roles.view"]));
    vi.mocked(prisma.role.findMany).mockResolvedValue([roleRow(1)] as never);
    render(
      <ToastProvider>{await AdminRolesPage({ searchParams: sp({}) })}</ToastProvider>,
    );
    const call = vi.mocked(prisma.role.findMany).mock.calls[0][0];
    expect(call?.take).toBe(21);
    expect(call?.where).toMatchObject({ deletedAt: null });
    // The order is by name, not by a random id.
    expect(call?.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
  });

  it("denied identity rejects before any read", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(FORBIDDEN);
    await expect(AdminRolesPage({ searchParams: sp({}) })).rejects.toThrow("NEXT_FORBIDDEN");
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });
});
