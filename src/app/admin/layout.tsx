// ADMIN SHELL LAYOUT (server).
//
// The permitted navigation is computed HERE from the session permission
// snapshot and handed to the shell as plain data — the shell never decides
// what a role may see. Every page re-verifies its own permission on the
// server; hiding a link is a convenience, never a boundary.
//
// The admin has its own visual identity (its own tokens, its own CSS file),
// completely separate from the storefront's design system.

import "./admin.css";
import type { Viewport } from "next";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { AdminShell } from "@/components/admin/admin-shell";
import { ADMIN_NAV_GROUPS, permittedNavGroups } from "@/components/admin/nav-config";
import { countOwnUnreadNotifications } from "@/lib/admin/notifications";

export const viewport: Viewport = { themeColor: "#18102c" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();

  // Not signed in: the login screen renders on the admin surface but without
  // the rail (there is nothing to navigate to yet).
  if (!admin) {
    return (
      <div className="adm-shell" dir="rtl">
        <main id="main" tabIndex={-1} className="adm-main">
          <div className="adm-main-inner">{children}</div>
        </main>
      </div>
    );
  }

  const groups = permittedNavGroups(ADMIN_NAV_GROUPS, admin.permissions);
  const unreadCount = await countOwnUnreadNotifications(admin).catch(() => null);

  return (
    <AdminShell
      groups={groups}
      user={{ name: admin.user.name, email: admin.user.email, roles: admin.roles }}
      unreadCount={unreadCount}
      canSearchProducts={admin.permissions.includes("products.view")}
    >
      {children}
    </AdminShell>
  );
}
