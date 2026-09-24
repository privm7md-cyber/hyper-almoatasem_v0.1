import { requirePermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export const metadata = {
  title: "المستخدمون — هايبر المعتصم",
};

// Super-Admin-only surface (requires users.manage): proves permission-level
// enforcement on a real page — STORE_ADMIN receives 403 via forbidden.tsx.
export default async function AdminUsersPage() {
  await requirePermission("users.manage");
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, isActive: true },
    orderBy: { email: "asc" },
  });
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="w-full max-w-lg rounded-2xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold">المستخدمون</h1>
        <ul className="mt-4 space-y-2 text-sm">
          {users.map((u) => (
            <li key={u.id}>
              {u.name} — {u.email} — {u.isActive ? "نشط" : "موقوف"}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
