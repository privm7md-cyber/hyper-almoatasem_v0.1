// FE-10F customer detail (server): identity + addresses + admin registration.
// Reads: customers.view. Writes: customers.manage (Phase-10 remediation,
// G03 — the customer domain is split into a read capability and a write
// capability; the read key no longer authorizes a customer mutation).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getCustomer, listAddressesByCustomer } from "@/lib/customers/queries";
import { toAddress } from "@/lib/customers/serialize";
import { AdminSection } from "@/components/admin/admin-table";
import { PermissionGate } from "@/components/admin/permission-gate";
import { CustomerRegisterForm } from "@/components/admin/customer-forms";
import { CustomerEditForm } from "@/components/admin/customer-edit-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل العميل — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("customers.view");
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
      <AdminSection title="بيانات العميل (customers.manage)">
        <PermissionGate permissions={admin.permissions} required="customers.manage" action="تعديل بيانات العميل">
          <CustomerEditForm
            customerId={row.id}
            firstName={row.firstName}
            lastName={row.lastName}
            email={row.email}
            autoAcceptReplacements={row.autoAcceptReplacements}
            isActive={row.isActive}
          />
        </PermissionGate>
      </AdminSection>
      {!row.isRegistered ? (
        <AdminSection title="تسجيل العميل (تعيين كلمة مرور — customers.manage)">
          <PermissionGate permissions={admin.permissions} required="customers.manage" action="تسجيل العميل">
            <CustomerRegisterForm customerId={row.id} />
          </PermissionGate>
        </AdminSection>
      ) : null}
    </main>
  );
}
