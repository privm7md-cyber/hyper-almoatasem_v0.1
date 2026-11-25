import {requirePermission} from "@/lib/auth/rbac";
import {PageHead} from "@/components/admin/ui/surfaces";
import {ProductMediaReview} from "@/components/admin/product-media-review";
export const dynamic="force-dynamic";
export default async function MediaReviewPage(){await requirePermission("products.view");await requirePermission("products.update");return <><PageHead title="مراجعة صور المنتجات" intro="ارفع صورة من مصدر مصرح به، وطابق الكود والعبوة قبل نشر الصورة. لا تُستبدل الصورة الرئيسية تلقائيًا."/><ProductMediaReview/></>;}
