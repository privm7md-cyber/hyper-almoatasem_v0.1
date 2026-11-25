import { Boxes, ClipboardList, Package, Percent, Ticket, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/rbac";
import { loadDashboardSnapshot } from "@/lib/admin/dashboard";
import { resolveDashboardRange } from "@/lib/admin/date-range";
import { formatDate, operatorDisplayName, roleLabel } from "@/lib/admin/terminology";
import { AdminViewportSceneControl } from "@/components/admin/scene/admin-scene";
import { DashboardMotion } from "@/components/admin/dashboard-motion";
import { DashboardAnalytics, DashboardRangeSelector } from "@/components/admin/dashboard-analytics";
import { ActionLink, PageHead } from "@/components/admin/ui/surfaces";
import styles from "@/components/admin/dashboard-analytics.module.css";

export const metadata = {
  title: "مركز التشغيل — لوحة إدارة هايبر المعتصم",
  description: "مؤشرات الطلبات حسب الفترة، والكتالوج والمخزون الحالي، مع تعريف المصادر وحدود المقارنة والتحصيل.",
  robots: { index: false, follow: false },
};

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminDashboardPage(props: DashboardPageProps) {
  const admin = await requireAdmin();
  const params = await props.searchParams;
  const readAt = new Date();
  const { range, error } = resolveDashboardRange(params, readAt);
  // Both SQL windows stop at equal elapsed durations when today is still open.
  const elapsed = Math.max(0, Math.min(readAt.getTime(), Date.parse(range.endExclusive)) - Date.parse(range.start));
  const queryRange = {
    ...range,
    endExclusive: new Date(Date.parse(range.start) + elapsed).toISOString(),
    previousEndExclusive: new Date(Date.parse(range.previousStart) + elapsed).toISOString(),
  };
  const data = error ? null : await loadDashboardSnapshot(admin.permissions, queryRange);
  const lanes = [
    { permission: "orders.view", href: "/admin/orders", icon: ClipboardList, title: "الطلبات", text: "راجع الطلبات وتابع التأكيد والتجهيز والتوصيل." },
    { permission: "products.view", href: "/admin/products", icon: Package, title: "المنتجات", text: "ابحث في الكتالوج وراجع حالة عرض كل منتج." },
    { permission: "inventory.view", href: "/admin/inventory", icon: Boxes, title: "المخزون", text: "راجع الأرصدة وأشكال البيع وعمليات المخزون." },
    { permission: "customers.view", href: "/admin/customers", icon: Users, title: "العملاء", text: "راجع بيانات العملاء وطلبات كل عميل." },
    { permission: "promotions.view", href: "/admin/promotions", icon: Percent, title: "العروض", text: "تابع العروض النشطة ومواعيد انتهائها." },
    { permission: "coupons.view", href: "/admin/coupons", icon: Ticket, title: "أكواد الخصم", text: "راجع الأكواد وشروط الاستخدام ومدتها." },
  ].filter((lane) => admin.permissions.includes(lane.permission));

  return (
    <div className={styles.dashboard}>
      <PageHead
        eyebrow={`مرحبًا، ${operatorDisplayName(admin.user.name, admin.roles)}`}
        title="لوحة الإدارة"
        intro="قراءة تنفيذية لشغل المتجر: طلبات الفترة، رصيد المخزون الآن، وخطوة المتابعة التالية. كل مؤشر يوضح مصدره وحدود حسابه."
        actions={<>
          <time dateTime={readAt.toISOString()} aria-label="تاريخ اليوم بتوقيت القاهرة"><bdi>{formatDate(readAt)}</bdi></time>
          <form action="/admin" method="get" aria-label="تحديث بيانات لوحة التشغيل">
            <input type="hidden" name="range" value={range.preset} />
            <input type="hidden" name="from" value={typeof params.from === "string" ? params.from : range.fromDay} />
            <input type="hidden" name="to" value={typeof params.to === "string" ? params.to : range.toDay} />
            <button type="submit" className="adm-btn adm-btn--secondary">تحديث البيانات</button>
          </form>
        </>}
      />
      <DashboardRangeSelector range={range} params={params} error={error} />
      {data && <DashboardAnalytics data={data} permissions={admin.permissions} />}
      <AdminViewportSceneControl
        roles={admin.roles.map((role) => roleLabel(role))}
        motionChild={<DashboardMotion />}
      />
      <section className="adm-section" aria-labelledby="dashboard-work-lanes">
        <div className={styles.sectionHead}><div><h2 id="dashboard-work-lanes">أقسام العمل</h2><p className={styles.muted}>الأقسام المتاحة لصلاحيات حسابك. روابط المؤشرات أعلاه تفتح المجموعة المصفّاة؛ هذه الروابط تفتح القسم كاملًا.</p></div></div>
        {lanes.length ? <div className="adm-cards">{lanes.map((lane) => <ActionLink key={lane.permission} href={lane.href} icon={lane.icon} title={lane.title} text={lane.text} />)}</div> : <p className={styles.muted}>لا توجد صلاحيات لفتح أقسام العمل. اطلب الصلاحيات المناسبة من مالك المتجر.</p>}
      </section>
    </div>
  );
}
