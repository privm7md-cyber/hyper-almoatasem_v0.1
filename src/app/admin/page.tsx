// FE-10B dashboard (evolved in place): identity card (kept) + honest operational links.
// No metrics endpoints exist — no KPIs, charts, or counts are shown or implied (D43).

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";

export const metadata = {
  title: "لوحة الإدارة — هايبر المعتصم",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { href: "/admin/orders", label: "الطلبات", hint: "قائمة الطلبات وحالاتها", perm: "orders.view" },
  { href: "/admin/products", label: "المنتجات", hint: "الكتالوج والأسعار", perm: "products.view" },
  { href: "/admin/inventory", label: "المخزون", hint: "الأرصدة والحركات", perm: "inventory.view" },
  { href: "/admin/customers", label: "العملاء", hint: "السجلات والعناوين", perm: "customers.view" },
  { href: "/admin/promotions", label: "العروض", hint: "القواعد والاستهداف", perm: "promotions.view" },
];

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const can = (perm: string) => admin.permissions.includes(perm);
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">لوحة الإدارة</h1>
      <section aria-label="بيانات الجلسة" className="rounded-card border border-line bg-white p-4">
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-secondary">الاسم:</dt>
            <dd>{admin.user.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-secondary">البريد:</dt>
            <dd>
              <bdi>{admin.user.email}</bdi>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-secondary">الأدوار:</dt>
            <dd>{admin.roles.join("، ")}</dd>
          </div>
        </dl>
      </section>
      <section aria-label="الأقسام التشغيلية">
        <ul className="grid gap-3 md:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.href} className="rounded-card border border-line bg-white p-4">
              <Link href={s.href} className="font-bold text-brand">
                {s.label}
              </Link>
              <p className="mt-1 text-sm text-secondary">{s.hint}</p>
              {!can(s.perm) ? (
                <p className="mt-1 text-xs text-secondary">
                  يتطلب صلاحية <span dir="ltr" className="font-mono">{s.perm}</span> — الصفحة سترد بالمنع.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-secondary">
        لا تعرض هذه اللوحة مؤشرات رقمية: لا توجد endpoints للمقاييس — أي رقم معروض لاحقًا يجب أن يأتي من مصدر معتمد.
      </p>
    </main>
  );
}
