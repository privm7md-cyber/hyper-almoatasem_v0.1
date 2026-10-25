// FE-7 order confirmation (server): rendered ONLY from a readable order (dual policy).
// No success ever shown from the submit click alone — this page 404s/gates otherwise.
// The path carries the order id only (display identifier, never a credential).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreShell } from "@/components/store/store-shell";
import { getOrderDetail } from "@/lib/frontend/order-reads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تأكيد الطلب",
  robots: { index: false, follow: false },
};

const STATUS_AR: Record<string, string> = {
  NEW: "تم استلام طلبك",
  CONFIRMED: "تم تأكيد الطلب",
  PREPARING: "جاري تجهيز طلبك",
  READY_FOR_DELIVERY: "طلبك جاهز",
  OUT_FOR_DELIVERY: "طلبك خرج للتوصيل",
  DELIVERED: "تم تسليم الطلب",
  CANCELLED: "تم إلغاء الطلب",
};

export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderDetail(id).catch(() => null);
  if (!result || "error" in result) {
    if (result && (result.error === "UNAUTHENTICATED" || result.error === "GONE")) {
      return (
        <StoreShell>
          <div className="mt-6">
            <p className="font-bold">تعذّر عرض التأكيد</p>
            <p className="mt-2 text-sm text-secondary">
              {result.error === "GONE"
                ? "انتهت صلاحية الوصول إلى هذا الطلب — راجع خطوات الوصول في صفحة المساعدة."
                : "افتح رابط الطلب من المتصفح نفسه أو سجّل الدخول للمتابعة."}
            </p>
            <p className="mt-2">
              <Link href="/order-help" className="font-semibold text-brand">
                مساعدة الطلب
              </Link>
            </p>
            <p className="mt-2">
              <Link href="/login" className="font-semibold text-brand">
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </StoreShell>
      );
    }
    notFound();
  }
  const { order } = result;
  return (
    <StoreShell>
      <div className="mt-6 grid gap-3">
        <h1 className="text-2xl font-extrabold">تم إنشاء طلبك بنجاح</h1>
        <p>
          رقم الطلب: <bdi className="font-bold">{order.orderNumber}</bdi>
        </p>
        <p>{STATUS_AR[order.status] ?? order.status}</p>
        <p>
          الإجمالي التقديري: <bdi className="font-bold">{order.totalEstimated} ج.م</bdi>
        </p>
        <p>
          <Link href={`/orders/${order.id}`} className="font-semibold text-brand">
            متابعة تفاصيل الطلب
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
