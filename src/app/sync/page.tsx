import { requireAdmin } from "@/lib/auth/rbac";
import { SyncCenter } from "@/components/catalog-sync/sync-center";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="adm-page-title">مزامنة الكتالوج مع الموقع</h1>
        <p className="text-sm text-[var(--studio-muted-text)]">من Hyper Catalog Review Studio إلى Hyper Al-Moatasem — معاينة ثلاثية الأطراف، تأكيد صريح، تطبيق ذري على بيئة مفصولة.</p>
      </header>
      <SyncCenter />
    </div>
  );
}
