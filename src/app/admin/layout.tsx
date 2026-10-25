// FE-10A admin shell layout (server): sidebar + topbar around section pages.
// Nav visibility follows the session permission snapshot (D45 hide-by-default);
// every gated page re-verifies server-side (visibility is UX only, never a boundary).

import Link from "next/link";
import { getCurrentAdmin } from "@/lib/auth/rbac";
import { logoutAction } from "@/app/actions/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { ADMIN_NAV_GROUPS, permittedNavGroups } from "@/components/admin/nav-config";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  // The permitted navigation is computed HERE (server side, from the session
  // permission snapshot) and handed to the nav island as plain data — the
  // island never decides what a role may see.
  const groups = permittedNavGroups(ADMIN_NAV_GROUPS, admin?.permissions ?? null);
  return (
    <div dir="rtl" className="min-h-screen bg-zinc-50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link href="/admin" className="text-lg font-extrabold text-brand">
              هايبر المعتصم <span className="text-sm font-semibold text-secondary">— الإدارة</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-secondary">{admin ? admin.user.name : "غير مسجّل"}</span>
            {admin ? (
              <form action={logoutAction}>
                <button type="submit" className="min-h-[44px] rounded-control border border-line bg-white px-4 text-sm font-semibold">
                  خروج
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-4 md:flex-row">
        <AdminNav groups={groups} />
        {/* D09/NAV-05: the admin shell also exposes the shared "#main" landmark and participates in SPA focus routing. */}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
