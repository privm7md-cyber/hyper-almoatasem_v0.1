// FE-10F audit log feed (server, read-only): newest-first with filters.
// Reads: requires audit_logs.view per backend gate (sessions pairing).
// Cursor note: backend orders (created_at DESC, id DESC); cursor is last row id.

import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listAudit } from "@/lib/admin/queries";
import { toAudit } from "@/lib/admin/serialize";
import { EmptyState, ErrorState } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "سجل التدقيق — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; cursor?: string }>;
}) {
  await requirePermission("audit_logs.view");
  const sp = await searchParams;
  const action = typeof sp.action === "string" && sp.action.trim() !== "" ? sp.action.trim().slice(0, 80) : null;
  const entityType =
    typeof sp.entityType === "string" && sp.entityType.trim() !== "" ? sp.entityType.trim().slice(0, 40) : null;
  const cursor = typeof sp.cursor === "string" && sp.cursor !== "" ? sp.cursor : null;
  let rows: ReturnType<typeof toAudit>[] | null = null;
  let next: string | null = null;
  try {
    const found = await listAudit({
      limit: 20,
      cursor,
      userId: null,
      action,
      entityType,
      entityId: null,
      since: null,
      until: null,
    });
    next = found.length > 20 ? found[20].id : null;
    rows = found.slice(0, 20).map(toAudit);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">سجل التدقيق</h1>
      <form method="get" action="/admin/audit-logs" className="flex flex-wrap gap-2">
        <label className="grid flex-1 gap-1 text-sm font-semibold">
          الإجراء
          <input name="action" defaultValue={action ?? ""} maxLength={80} dir="ltr" placeholder="role.assign" className="min-h-[44px] rounded-control border border-line bg-white px-3 font-mono text-sm" />
        </label>
        <label className="grid flex-1 gap-1 text-sm font-semibold">
          نوع الكيان
          <input name="entityType" defaultValue={entityType ?? ""} maxLength={40} dir="ltr" placeholder="role" className="min-h-[44px] rounded-control border border-line bg-white px-3 font-mono text-sm" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="min-h-[44px] rounded-control bg-brand px-5 font-semibold text-white">
            تصفية
          </button>
        </div>
      </form>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد إدخالات مطابقة" hint="وسّع المرشحات." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((a) => (
            <li key={a.id} className="rounded-card border border-line bg-white p-3 text-sm">
              <Link href={`/admin/audit-logs/${a.id}`} className="font-bold text-brand">
                <span dir="ltr" className="font-mono">{a.action}</span> — {a.entityType}
              </Link>
              <p className="text-secondary">
                {a.createdAt} · {a.actorType}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <p>
          <Link
            href={`/admin/audit-logs?${new URLSearchParams({
              ...(action ? { action } : {}),
              ...(entityType ? { entityType } : {}),
              cursor: next,
            }).toString()}`}
            className="font-semibold text-brand"
          >
            الصفحة التالية
          </Link>
        </p>
      ) : null}
    </main>
  );
}
