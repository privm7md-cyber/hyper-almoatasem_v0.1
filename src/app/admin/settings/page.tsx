// ADMIN SETTINGS — the settings that steer the store (server).
//
// ADM-10: the screen used to render one flat table of whatever rows existed
// in `store_settings`, with no section, no type, no allowed range and no
// explicit "editable" flag. It now renders the REGISTRY
// (`src/lib/admin/settings-registry.ts`): every setting the project really
// provisions, in a section, with its meaning, its effect, its type, its
// allowed range and whether it may be changed at all.
//
// A row that exists in the database but not in the registry is shown in a
// separate panel and is NOT editable (the registry is the allow-list).
//
// A secret-looking setting is never printed: the operator is told the value is
// hidden instead of seeing it.

import type { Metadata } from "next";
import { listSettings } from "@/lib/admin/queries";
import { requirePermission } from "@/lib/auth/rbac";
import {
  SETTING_REGISTRY,
  SETTING_SECTIONS,
  isSecretSettingKey,
  settingRegistryEntry,
} from "@/lib/admin/settings-registry";
import { PermissionGate } from "@/components/admin/permission-gate";
import { SettingEditForm } from "@/components/admin/setting-forms";
import { DataTable, ErrorState, Note, PageHead, Panel, Pill } from "@/components/admin/ui/surfaces";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "إعدادات المتجر — الإدارة",
  robots: { index: false, follow: false },
};

/** Settings whose value is a technical identifier, shown in the quiet style. */
const IDENTIFIER_KEYS = new Set(["currency", "timezone"]);

function valueText(key: string, value: string, valueType: string) {
  if (isSecretSettingKey(key)) return "مخفي";
  if (valueType === "BOOLEAN") return value === "true" ? "مفعّل" : "موقوف";
  if (valueType === "INTEGER" || valueType === "NUMERIC") {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toLocaleString("en-US") : "—";
  }
  if (value === "") return "فاضي";
  return value;
}

const TYPE_LABELS: Record<string, string> = {
  TEXT: "نص",
  BOOLEAN: "مفتاح تشغيل/إيقاف",
  INTEGER: "رقم صحيح",
  NUMERIC: "مبلغ",
  JSON: "بيانات JSON",
};

export default async function AdminSettingsPage() {
  const admin = await requirePermission("settings.view");

  const rows = await listSettings().catch(() => null);
  const byKey = new Map((rows ?? []).map((row) => [row.key, row]));
  // The rows the registry knows about, grouped by their section.
  const registryRows = SETTING_REGISTRY.map((entry) => ({ entry, row: byKey.get(entry.key) ?? null }));
  // A row in the database that the registry does not know: shown, not editable.
  const unknownRows = (rows ?? []).filter((row) => settingRegistryEntry(row.key) === null);

  return (
    <>
      <PageHead
        eyebrow="الإدارة"
        title="إعدادات المتجر"
        intro="الإعدادات دي هي اللي بتتحكم في المتجر كله: الاسم والتواصل، والطلبات، والأسعار، والمخزون، والحسابات، والإشعارات، والأمان. كل إعداد مكتوب اسمه ومعناه وأثره، والقيمة الحالية بتيجي من قاعدة البيانات."
      />

      {rows === null ? (
        <ErrorState
          title="مفيش تحميل للإعدادات"
          hint="حصلت مشكلة في جلب إعدادات المتجر من قاعدة البيانات. جرّب تعمل تحديث للصفحة."
        />
      ) : (
        <>
          {SETTING_SECTIONS.map((section) => {
            const entries = registryRows.filter((item) => item.entry.section === section.key);
            if (entries.length === 0) return null;
            return (
              <Panel key={section.key} title={section.title} sub={section.intro} flush>
                <DataTable
                  caption={`${section.title} — الإعدادات`}
                  columns={[
                    { header: "الإعداد" },
                    { header: "المعنى والأثر" },
                    { header: "النوع" },
                    { header: "القيمة الحالية" },
                    { header: "النطاق المسموح" },
                    { header: "قابل للتعديل؟" },
                  ]}
                  rows={entries.map(({ entry, row }) => [
                    <span className="adm-cell-main" key="name">
                      <span className="adm-cell-title">{entry.label}</span>
                    </span>,
                    <span className="adm-cell-sub" key="meaning">
                      {entry.meaning} {entry.effect}{" "}
                      {!entry.consumedByApp ? <Pill tone="warn">مش مستخدم في الكود</Pill> : null}
                    </span>,
                    <span className="adm-cell-sub" key="type">
                      {TYPE_LABELS[entry.valueType] ?? entry.valueType}
                    </span>,
                    row === null ? (
                      <span className="adm-cell-sub" key="value">
                        مش موجود في قاعدة البيانات
                      </span>
                    ) : IDENTIFIER_KEYS.has(entry.key) ? (
                      <span className="adm-cell-id" dir="ltr" key="value">
                        {valueText(entry.key, row.valueText, row.valueType)}
                      </span>
                    ) : (
                      <span key="value">{valueText(entry.key, row.valueText, row.valueType)}</span>
                    ),
                    <span className="adm-cell-sub" key="range">
                      {entry.rangeNote ?? "أي قيمة من النوع ده."}
                    </span>,
                    !entry.editable ? (
                      <Pill key="editable" tone="warn">
                        لأ — للعرض فقط
                      </Pill>
                    ) : row === null ? (
                      <Pill key="editable" tone="warn">
                        لأ — مش موجود في القاعدة
                      </Pill>
                    ) : (
                      <Pill key="editable" tone="success">
                        أه
                      </Pill>
                    ),
                  ])}
                  emptyLabel="مفيش إعدادات في القسم ده."
                />
              </Panel>
            );
          })}

          {unknownRows.length > 0 ? (
            <Panel
              title="إعدادات خارج الدليل"
              sub="صفوف موجودة في قاعدة البيانات ومش مسجّلة في دليل الإعدادات — بتظهر للقراءة فقط"
              flush
            >
              <DataTable
                caption="إعدادات غير مسجّلة في الدليل"
                columns={[{ header: "الإعداد" }, { header: "القيمة" }, { header: "الحالة" }]}
                rows={unknownRows.map((row) => [
                  <span className="adm-cell-main" key="name">
                    <span className="adm-cell-title">{row.key}</span>
                    <span className="adm-cell-id" dir="ltr">
                      {row.valueType}
                    </span>
                  </span>,
                  <span key="value">{valueText(row.key, row.valueText, row.valueType)}</span>,
                  <Pill key="state" tone="warn">
                    للعرض فقط
                  </Pill>,
                ])}
                emptyLabel="مفيش إعدادات خارج الدليل."
              />
            </Panel>
          ) : null}

          <Panel title="تعديل الإعدادات" sub="القيمة الجديدة بتتحفظ بعد ما المتجر يتحقق منها">
            <PermissionGate permissions={admin.permissions} required="settings.manage" action="تعديل إعدادات المتجر">
              {registryRows.filter(({ entry, row }) => entry.editable && row !== null).length === 0 ? (
                <p className="adm-hint">مفيش إعدادات قابلة للتعديل دلوقتي.</p>
              ) : (
                <div className="adm-stagger">
                  {registryRows
                    .filter(({ entry, row }) => entry.editable && row !== null)
                    .map(({ entry, row }) => (
                      <div className="adm-field" key={entry.key}>
                        <span className="adm-cell-title">{entry.label}</span>
                        <span className="adm-cell-sub">
                          {entry.effect} {entry.rangeNote ?? ""}{" "}
                          {!entry.consumedByApp ? <Pill tone="warn">مش مستخدم في الكود</Pill> : null}
                        </span>
                        <SettingEditForm
                          settingKey={entry.key}
                          value={row?.valueText ?? ""}
                          valueType={entry.valueType}
                        />
                      </div>
                    ))}
                </div>
              )}
            </PermissionGate>
          </Panel>
        </>
      )}

      <Note tone="info">
        كل قيمة بتتحفظ في المتجر وبتتحدث على طول. لو القيمة مش مناسبة للإعداد، المتجر بيرفضها ويرجعلك
        رسالة واضحة من غير ما يغيّر حاجة.
      </Note>

      <Note tone="warn">
        الإعدادات دي بس هي اللي المشروع بيزوّدها فعلًا. أي إعداد تاني في قاعدة البيانات بيظهر تحت
        «إعدادات خارج الدليل» ومش بيتغيّر من هنا.
      </Note>
    </>
  );
}
