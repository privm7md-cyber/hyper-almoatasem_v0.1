import { requireAdmin } from "@/lib/auth/rbac";
import { logoutAction } from "@/app/actions/auth";

export const metadata = {
  title: "لوحة الإدارة — هايبر المعتصم",
};

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="w-full max-w-lg rounded-2xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold">لوحة الإدارة</h1>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-zinc-600">الاسم:</dt>
            <dd>{admin.user.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-zinc-600">البريد:</dt>
            <dd>{admin.user.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-zinc-600">الأدوار:</dt>
            <dd>{admin.roles.join("، ")}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-zinc-600">الصلاحيات:</dt>
            <dd>{admin.permissions.length}</dd>
          </div>
        </dl>
        <form action={logoutAction} className="mt-6">
          <button type="submit" className="rounded bg-zinc-900 px-4 py-2 text-white">
            تسجيل الخروج
          </button>
        </form>
      </main>
    </div>
  );
}
