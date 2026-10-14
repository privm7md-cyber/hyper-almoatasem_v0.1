// FE-10F audit entry detail (server, read-only): full old/new value payloads.
// Values are JSON — rendered in dir=ltr pre blocks. No writes exist.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { getAudit } from "@/lib/admin/queries";
import { toAudit } from "@/lib/admin/serialize";
import { AdminSection } from "@/components/admin/admin-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إدخال التدقيق — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminAuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("audit_logs.view");
  const { id } = await params;
  const row = await getAudit(id).catch(() => null);
  if (!row) notFound();
  const entry = toAudit(row);

  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">
        <span dir="ltr" className="font-mono">{entry.action}</span>
      </h1>
      <dl className="grid gap-1 rounded-card border border-line bg-white p-4 text-sm">
        <div className="flex gap-2"><dt className="font-semibold">الكيان:</dt><dd>{entry.entityType}</dd></div>
        <div className="flex gap-2"><dt className="font-semibold">معرف الكيان:</dt><dd dir="ltr" className="font-mono">{entry.entityId ?? "—"}</dd></div>
        <div className="flex gap-2"><dt className="font-semibold">الفاعل:</dt><dd>{entry.actorType} · <span dir="ltr" className="font-mono">{entry.userId ?? "—"}</span></dd></div>
        <div className="flex gap-2"><dt className="font-semibold">الوقت:</dt><dd dir="ltr">{entry.createdAt}</dd></div>
        <div className="flex gap-2"><dt className="font-semibold">IP:</dt><dd dir="ltr" className="font-mono">{entry.ipAddress ?? "—"}</dd></div>
      </dl>
      <AdminSection title="القيم السابقة">
        <pre dir="ltr" className="overflow-x-auto rounded-card bg-surface p-3 font-mono text-xs">
          {entry.oldValues === null ? "—" : JSON.stringify(entry.oldValues, null, 2)}
        </pre>
      </AdminSection>
      <AdminSection title="القيم الجديدة">
        <pre dir="ltr" className="overflow-x-auto rounded-card bg-surface p-3 font-mono text-xs">
          {entry.newValues === null ? "—" : JSON.stringify(entry.newValues, null, 2)}
        </pre>
      </AdminSection>
    </main>
  );
}
