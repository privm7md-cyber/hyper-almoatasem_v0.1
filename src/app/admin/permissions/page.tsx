// ADMIN PERMISSIONS — the catalogue of everything a staff member can do.
//
// This page is a catalogue, not a log and not a switchboard: it lists the
// capabilities the store knows, grouped by the part of the store they belong
// to, in the words the team uses.
//
// A capability is not granted to a person directly. It is granted to a role,
// and it only works for someone who holds that role. That is why nothing on
// this page can be switched on or off here.

import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import {
  PERMISSION_GROUPS,
  permissionCapabilityLabel,
  permissionDescription,
  permissionLabel,
} from "@/lib/admin/terminology";
import { DataTable, ErrorState, Note, PageHead, Panel, Pill } from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "صلاحيات المستخدمين — الإدارة",
  robots: { index: false, follow: false },
};

export default async function AdminPermissionsPage() {
  await requirePermission("roles.view");

  const permissions = await prisma.permission
    .findMany({ where: { isActive: true }, orderBy: [{ key: "asc" }] })
    .catch(() => null);

  const known = permissions ? new Set(permissions.map((permission) => permission.key)) : new Set<string>();
  // DRIFT (owner decision, 12 Nov 2026): the code catalogue and the database
  // can disagree — a permission the code knows but the database does not have
  // is a capability NOBODY can be granted. The page says so instead of
  // silently hiding the gap.
  const catalogueKeys = PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((permission) => permission.key),
  );
  const missing = catalogueKeys.filter((key) => !known.has(key));
  const grouped = PERMISSION_GROUPS.map((group) => ({
    group,
    keys: group.permissions.map((permission) => permission.key).filter((key) => known.has(key)),
  })).filter((entry) => entry.keys.length > 0);
  const ungrouped = permissions
    ? permissions.filter((permission) => !PERMISSION_GROUPS.some((group) => group.permissions.some((p) => p.key === permission.key)))
    : [];

  return (
    <>
      <PageHead
        eyebrow="الأدوار"
        title="صلاحيات المستخدمين"
        intro="دي كل حاجة ممكن حد في فريق المتجر يعملها. الصلاحيات مرتبة حسب أقسام المتجر، وكل صلاحية مكتوبة باسمها العادي عشان الفريق يفهمها من غير ما يعرف الكود بتاعها."
      />

      <Note tone="info">
        الصلاحيات مش بتتدي للفرد على طول. كل صلاحية بتتدي لدور، وهي بتشتغل بس مع العضو اللي يشغل الدور
        ده. عشان تدي صلاحية لحد، افتح صفحة الدور بتاعه وضيفها فيه.
      </Note>

      <Note tone="warn">
        <strong>الصلاحية الحساسة</strong> (إخفاء هوية العميل، حذف المنتجات، عرض الأسعار، وإدارة الأدوار)
        مش بتُشغَّل بمجرد وجودها في الكتالوج: لازم تكون موجودة في قاعدة البيانات <em>و</em> ممنوحة
        للدور، وفي حالة إخفاء هوية العميل محتاجة اعتماد المالك كمان.
      </Note>

      {permissions === null ? (
        <ErrorState
          title="مفيش تحميل للكتالوج"
          hint="حصلت مشكلة في جلب الصلاحيات من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <>
          {permissions !== null && missing.length > 0 ? (
            <Panel
              title="صلاحيات ناقصة في قاعدة البيانات"
              sub="الكود بيعرف صلاحيات أكتر من المسجّلة في القاعدة — وده معناه إن محدش يقدر ياخدها"
              flush
            >
              <DataTable
                caption="صلاحيات موجودة في الكود ومش موجودة في قاعدة البيانات"
                columns={[{ header: "الصلاحية" }, { header: "الوصف" }, { header: "الحل" }]}
                rows={missing.map((key) => [
                  <span className="adm-cell-id" dir="ltr" key="key">
                    {key}
                  </span>,
                  <span className="adm-cell-title" key="label">
                    {permissionLabel(key)}
                  </span>,
                  <span className="adm-cell-sub" key="fix">
                    ضيفها في قاعدة البيانات (خطوة الصلاحيات في سكربت البذور بتعمل ده بشكل آمن ومكرر)، وبعدين
                    امنحها للدور من صفحة الأدوار.
                  </span>,
                ])}
                emptyLabel="مفيش صلاحيات ناقصة."
              />
            </Panel>
          ) : null}

          {grouped.map(({ group, keys }) => (
            <Panel key={group.title} title={group.title} sub={group.intro} flush>
              <DataTable
                caption={`${group.title} — الصلاحيات المتاحة`}
                columns={[
                  { header: "الصلاحية" },
                  { header: "النوع" },
                  { header: "الشرح" },
                ]}
                rows={keys.map((key) => {
                  const entry = group.permissions.find((permission) => permission.key === key);
                  return [
                    <span key={`${key}-key`} className="adm-cell-main">
                      <span className="adm-cell-title">{permissionLabel(key)}</span>
                      <span className="adm-cell-id" dir="ltr">
                        {key}
                      </span>
                    </span>,
                    <span key={`${key}-cap`} className="adm-cell-main">
                      <Pill tone={entry?.sensitive ? "warn" : "neutral"}>
                        {entry ? permissionCapabilityLabel(entry.capability) : "—"}
                      </Pill>
                      {entry?.sensitive ? (
                        <span className="adm-cell-sub">صلاحية حساسة</span>
                      ) : null}
                    </span>,
                    <span key={`${key}-desc`} className="adm-cell-sub">
                      {permissionDescription(key)}
                    </span>,
                  ];
                })}
                emptyLabel="مفيش صلاحيات في القسم ده."
              />
            </Panel>
          ))}

          {ungrouped.length > 0 ? (
            <Panel title="صلاحيات تانية" sub="صلاحيات موجودة في النظام ومش متجمّعة تحت قسم معروف" flush>
              <DataTable
                caption="صلاحيات غير مصنّفة"
                columns={[{ header: "الصلاحية" }, { header: "الوصف" }]}
                rows={ungrouped.map((permission) => [
                  <span className="adm-cell-id" dir="ltr" key="key">
                    {permission.key}
                  </span>,
                  <span className="adm-cell-title" key="label">
                    {permissionLabel(permission.key)}
                  </span>,
                ])}
                emptyLabel="مفيش صلاحيات غير مصنّفة."
              />
            </Panel>
          ) : null}
        </>
      )}
    </>
  );
}
