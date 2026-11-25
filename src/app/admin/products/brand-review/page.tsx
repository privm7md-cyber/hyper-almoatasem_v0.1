import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/rbac";
import { listBrandAssociationReviewCandidates } from "@/lib/catalog/brand-association-review";
import { PageHead } from "@/components/admin/ui/surfaces";
import { BrandAssociationReviewWorkbench } from "@/components/admin/brand-association-review-workbench";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "مراجعة ربط المنتجات بالماركات — الإدارة",
  robots: { index: false, follow: false },
};

export default async function BrandAssociationReviewPage() {
  const admin = await requirePermission("products.update");
  await requirePermission("products.view");

  const initial = await listBrandAssociationReviewCandidates({
    classification: "ALL",
    search: null,
    brandId: null,
    offset: 0,
    limit: 50,
  });

  return (
    <>
      <PageHead
        eyebrow="المنتجات"
        title="مراجعة ربط المنتجات بالماركات"
        intro="اقتراحات مشتقة من اسم المنتج وقائمة المالك، مع معاينة إلزامية وتأكيد صريح لكل دفعة. لا يوجد ربط تلقائي، ولا تُستبدل ماركة موجودة، وكل تعديل يُسجَّل في سجل التدقيق."
        actions={
          <>
            <Link href="/admin/products/bulk" className="adm-btn adm-btn--secondary">العمليات الجماعية</Link>
            <Link href="/admin/products" prefetch={false} className="adm-btn adm-btn--secondary">العودة إلى المنتجات</Link>
          </>
        }
      />
      <BrandAssociationReviewWorkbench
        initial={initial}
        permissions={{ canApply: admin.permissions.includes("products.update") }}
      />
    </>
  );
}
