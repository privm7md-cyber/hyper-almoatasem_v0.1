// Server-side RBAC: the ONLY authorization boundary.
// UI visibility is never authorization — every sensitive Server Action, Route
// Handler and protected page must call requireAdmin()/requirePermission().
// Effective grant (frozen rule): active user AND active role AND mapping row.
// Disabled users authorize nothing, including through pre-existing sessions
// (re-checked on every validation, never cached across requests except the
// per-request React cache below).
import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSessionCookie, validateSessionToken } from "@/lib/auth/session";

export interface AdminContext {
  user: { id: string; name: string; email: string };
  roles: string[];
  permissions: string[];
}

/**
 * Load the current admin from the session cookie. Returns null for every
 * invalid state (no cookie, unknown/revoked/expired session, inactive or
 * soft-deleted user). Memoized per request.
 */
export const getCurrentAdmin = cache(async (): Promise<AdminContext | null> => {
  const rawToken = await readSessionCookie();
  const session = await validateSessionToken(rawToken);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      deletedAt: true,
      userRoles: {
        select: {
          role: {
            select: {
              name: true,
              isActive: true,
              rolePermissions: {
                select: { permission: { select: { key: true, isActive: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!user || !user.isActive || user.deletedAt !== null) return null;
  const roles: string[] = [];
  const permissions = new Set<string>();
  for (const ur of user.userRoles) {
    if (!ur.role.isActive) continue;
    roles.push(ur.role.name);
    for (const rp of ur.role.rolePermissions) {
      if (rp.permission.isActive) permissions.add(rp.permission.key);
    }
  }
  return {
    user: { id: user.id, name: user.name, email: user.email },
    roles,
    permissions: [...permissions],
  };
});

/** Pages: redirect anonymous admins to login. */
export async function requireAdmin(): Promise<AdminContext> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/** Pages: redirect anonymous, forbid unauthorized (Next.js forbidden.js → 403). */
export async function requirePermission(permission: string): Promise<AdminContext> {
  const { forbidden } = await import("next/navigation");
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!admin.permissions.includes(permission)) forbidden();
  return admin;
}

/** Actions/APIs: null-safe variants returning error codes instead of throwing. */
export async function checkPermission(
  permission: string,
): Promise<{ ok: true; admin: AdminContext } | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" }> {
  const admin = await getCurrentAdmin();
  if (!admin) return { ok: false, code: "UNAUTHENTICATED" };
  if (!admin.permissions.includes(permission)) return { ok: false, code: "FORBIDDEN" };
  return { ok: true, admin };
}

export async function requireRole(role: string): Promise<AdminContext> {
  const { forbidden } = await import("next/navigation");
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!admin.roles.includes(role)) forbidden();
  return admin;
}
