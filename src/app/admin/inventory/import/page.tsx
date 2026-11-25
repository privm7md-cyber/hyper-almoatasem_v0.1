import { requirePermission } from "@/lib/auth/rbac";
import { PageHead } from "@/components/admin/ui/surfaces";
import { InventoryImportWorkbench } from "@/components/admin/inventory-import-workbench";
export const dynamic="force-dynamic";
export default async function InventoryImportPage() {
  await requirePermission("inventory.view");
  await requirePermission("inventory.adjust");
  return <><PageHead title="استيراد مخزون الكاشير" intro="اختيار الملف وربط الأعمدة، ثم مراجعة الفروق وتأكيد الأرصدة المعتمدة. لا تُستورد الأسعار." /><InventoryImportWorkbench /></>;
}
