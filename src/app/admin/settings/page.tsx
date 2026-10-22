// FE-10F store settings (server): read-only catalog + typed per-key edit.
// Reads: settings.view. Writes: settings.manage (PATCH value as string; server
// coerces by valueType + rejects invalid values).

import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listSettings } from "@/lib/admin/queries";
import { toSetting } from "@/lib/admin/serialize";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { PermissionGate } from "@/components/admin/permission-gate";
import { SettingEditForm } from "@/components/admin/setting-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إعدادات المتجر — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminSettingsPage() {
  const admin = await requirePermission("settings.view");
  let rows: ReturnType<typeof toSetting>[] | null = null;
  try {
    rows = (await listSettings()).map(toSetting);
  } catch {
    rows = null;
  }
  return (
    <main className="grid gap-4">
      <h1 className="text-xl font-bold">إعدادات المتجر</h1>
      <p className="text-sm text-secondary">
        القيم تُحفظ كنص وتُدقق حسب نوعها على الخادم — القيمة المرفوضة تُعاد برسالة خطأ.
      </p>
      {rows === null ? (
        <ErrorState title="تعذّر التحميل" text="حاول مجددًا." />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد إعدادات" hint="لم تُهيأ إعدادات بعد." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((s) => (
            <li key={s.key} className="rounded-card border border-line bg-white p-3">
              <p dir="ltr" className="font-mono text-sm font-bold">{s.key}</p>
              {s.description ? <p className="text-sm text-secondary">{s.description}</p> : null}
              <p className="text-xs text-secondary">النوع: <span dir="ltr" className="font-mono">{s.valueType}</span> · آخر تحديث: {s.updatedAt}</p>
              <div className="mt-2">
                <PermissionGate permissions={admin.permissions} required="settings.manage" action="تعديل إعدادات المتجر">
                  <SettingEditForm settingKey={s.key} value={s.value} valueType={s.valueType} />
                </PermissionGate>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
