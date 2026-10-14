// FE-10F customer detail (server): identity + addresses + admin registration.
// Reads: customers.view. Writes: customers.view-scoped register (password set) — closest
// capability mapping per route contract. No profile edits invented (no endpoint).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getCustomer, listAddressesByCustomer } from "@/lib/customers/queries";
import { toAddress } from "@/lib/customers/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { CustomerRegisterForm } from "@/components/admin/customer-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل العميل — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.view");
  const { id } = await params;
  const row = await getCustomer(id).catch(() => null);
  if (!row) notFound();
  const addresses = await listAddressesByCustomer(id).catch(() => []);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">{row.firstName}</h1>
      <p className="text-sm text-secondary">
        <bdi>{row.phone}</bdi> · {row.isRegistered ? "مسجل" : "ضيف"} · {row.isActive ? "نشط" : "موقوف"}
      </p>
      <AdminSection title="العناوين">
        {addresses.length === 0 ? (
          <p className="text-sm text-secondary">لا توجد عناوين.</p>
        ) : (
          <ul className="grid gap-2">
            {addresses.map((a) => {
              const s = toAddress(a);
              return (
                <li key={s.id} className="rounded-card border border-line bg-white p-3 text-sm">
                  <p className="font-bold">
                    {s.label ?? s.city}
                    {s.isDefault ? <span className="ms-2 text-success">(افتراضي)</span> : null}
                  </p>
                  <p className="text-secondary">
                    {[s.city, s.area, s.street].filter(Boolean).join("، ")} · <bdi>{s.phone}</bdi>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </AdminSection>
      {!row.isRegistered ? (
        <AdminSection title="تسجيل العميل (تعيين كلمة مرور)">
          <CustomerRegisterForm customerId={row.id} />
        </AdminSection>
      ) : null}
    </main>
  );
}
