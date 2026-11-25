import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/rbac";
import {
  NOTIFICATION_TYPE_OPTIONS,
  isKnownNotificationType,
  listOwnNotifications,
} from "@/lib/admin/notifications";
import { formatDateTime } from "@/lib/admin/terminology";
import { EmptyState, ErrorState, Note, PageHead, Pager, Panel, StatusPill } from "@/components/admin/ui/surfaces";
import { AdminRetryButton } from "@/components/admin/ui/controls";
import { MarkAllNotificationsRead, MarkNotificationRead, SweepStoreAlerts } from "./notification-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الإشعارات — الإدارة", robots: { index: false, follow: false } };

export default async function NotificationsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const unread = params.unread === "true";
  // ADM-11: the type filter is restricted to the types this build writes; an
  // unknown value is ignored rather than trusted or echoed.
  const rawType = typeof params.type === "string" ? params.type : "";
  const type = rawType && isKnownNotificationType(rawType) ? rawType : null;
  const cursor = typeof params.cursor === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.cursor) ? params.cursor : null;
  const invalidCursor = params.cursor !== undefined && cursor === null;
  const page = invalidCursor ? null : await listOwnNotifications(admin, cursor, unread, type).catch(() => null);
  const hrefFor = (nextUnread: boolean, nextType: string | null) => {
    const search = new URLSearchParams();
    if (nextUnread) search.set("unread", "true");
    if (nextType) search.set("type", nextType);
    const query = search.toString();
    return query ? `/admin/notifications?${query}` : "/admin/notifications";
  };
  const startHref = hrefFor(unread, type);
  return (
    <>
      <PageHead eyebrow="إدارة النظام" title="الإشعارات" intro="صندوق إشعارات حسابك فقط؛ لا يعرض إشعارات أعضاء الفريق الآخرين." actions={<AdminRetryButton />} />
      <nav className="adm-btn-row" aria-label="تصفية الإشعارات">
        <Link href={hrefFor(false, type)} className="adm-btn adm-btn--secondary" aria-current={!unread ? "page" : undefined}>الكل</Link>
        <Link href={hrefFor(true, type)} className="adm-btn adm-btn--secondary" aria-current={unread ? "page" : undefined}>غير المقروءة</Link>
      </nav>
      <nav className="adm-btn-row" aria-label="تصفية حسب النوع">
        <Link href={hrefFor(unread, null)} className="adm-btn adm-btn--secondary adm-btn--sm" aria-current={type === null ? "page" : undefined}>كل الأنواع</Link>
        {NOTIFICATION_TYPE_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={hrefFor(unread, option.value)}
            className="adm-btn adm-btn--secondary adm-btn--sm"
            aria-current={type === option.value ? "page" : undefined}
          >
            {option.label}
          </Link>
        ))}
      </nav>
      <Note>
        الإشعارات اللي بتوصل هنا بيسجلها النظام من أحداث حقيقية: وصول طلب جديد، نفاد كمية منتج، وصول
        الكمية لحد التنبيه، اقتراب انتهاء عرض أو كود خصم، تغيير صلاحيات، أو قفل حساب. كل إشعار بيتسجل
        مرة واحدة لنفس الحدث. تقدر تعلّم إشعار كمقروء أو تعلّم الصندوق كله، والحالة بتتحفظ في قاعدة
        البيانات.
      </Note>
      {invalidCursor || page?.invalidCursor ? (
        <ErrorState title="رابط الصفحة لم يعد متاحًا" hint={<>ارجع لبداية الصندوق لعرض أحدث الإشعارات المتاحة لحسابك. <Link className="adm-btn adm-btn--secondary" href={startHref}>بداية الصندوق</Link></>} />
      ) : !page ? (
        <ErrorState title="البيانات غير متاحة حاليًا" hint="تعذر تحميل صندوق الحساب؛ استخدم إعادة المحاولة لتحديث القراءة." />
      ) : page.rows.length === 0 && cursor ? (
        <EmptyState title="وصلت لنهاية الإشعارات" hint="لا توجد إشعارات إضافية بعد هذه الصفحة ضمن الفلتر الحالي." action={<Link className="adm-btn adm-btn--secondary" href={startHref}>بداية الصندوق</Link>} />
      ) : page.rows.length === 0 ? (
        <EmptyState title={unread ? "لا توجد إشعارات غير مقروءة" : "لا توجد إشعارات لحسابك"} hint="ستظهر هنا الرسائل المسجلة لهذا الحساب عند توفرها." />
      ) : (
        <Panel title="صندوق الحساب" actions={
          <span className="adm-btn-row adm-btn-row--tight">
            {admin.permissions.includes("inventory.view") && admin.permissions.includes("promotions.view") ? (
              <SweepStoreAlerts />
            ) : null}
            <MarkAllNotificationsRead />
          </span>
        }>
          <ul className="adm-notif-list">
            {page.rows.map((row) => (
              <li key={row.id} className={row.readAt ? "adm-notif-item" : "adm-notif-item adm-notif-item--unread"}>
                <div className="adm-btn-row adm-btn-row--tight">
                  <h2 className="adm-notif-title">{row.title}</h2>
                  <StatusPill tone={row.readAt ? "neutral" : "info"}>{row.readAt ? "مقروء" : "غير مقروء"}</StatusPill>
                </div>
                <p className="adm-notif-body">{row.message}</p>
                <div className="adm-btn-row adm-btn-row--tight">
                  <time dateTime={row.createdAt.toISOString()} dir="ltr" className="adm-notif-time">{formatDateTime(row.createdAt)}</time>
                  {row.readAt ? null : <MarkNotificationRead id={row.id} />}
                </div>
              </li>
            ))}
          </ul>
          <Pager basePath="/admin/notifications" params={{ unread: unread ? "true" : undefined, type: type ?? undefined }} nextCursor={page.nextCursor} label="إشعار" />
        </Panel>
      )}
    </>
  );
}
