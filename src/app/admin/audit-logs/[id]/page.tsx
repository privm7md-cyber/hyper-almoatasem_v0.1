// ADMIN AUDIT DETAIL — one change, read as a story (server).
//
// The page answers four questions in Arabic: who did it, what they did, when,
// and which part of the store it touched. The values are listed field by
// field in the words the store uses, so the operator can read the change
// without knowing the field names.
//
// The raw payload stays where it belongs: inside the labelled technical block
// at the bottom, for whoever needs the machine view.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { getAudit } from "@/lib/admin/queries";
import { toAudit } from "@/lib/admin/serialize";
import {
  AUDIT_ENTITY_LABELS,
  CODE_TYPE_LABELS,
  MOVEMENT_TYPE_LABELS,
  ORDER_ITEM_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  SETTING_LABELS,
  actorTypeLabel,
  auditEntityLabel,
  formatDateTime,
  formatMoney,
  formatQuantity,
  itemStatusLabel,
  movementTypeLabel,
  orderStatusLabel,
  permissionLabel,
  settingLabel,
} from "@/lib/admin/terminology";
import { EmptyState, KeyValue, Note, PageHead, Panel, Pill } from "@/components/admin/ui/surfaces";
import { auditActionOutcome, maskAuditValues } from "@/lib/admin/audit-vocabulary";
import { roleDisplayName } from "../../roles/role-labels";
import { auditActionText, auditEntityText, auditResultText } from "../audit-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تفاصيل التغيير — الإدارة",
  robots: { index: false, follow: false },
};

/** The field names the store writes, in the words the operator reads. */
const FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  slug: "معرف الرابط",
  email: "البريد الإلكتروني",
  phone: "رقم التليفون",
  isActive: "حالة الحساب",
  isPrimary: "صورة أساسية",
  isRegistered: "حساب مسجّل",
  role: "الدور",
  permission: "الصلاحية",
  key: "الإعداد",
  value: "القيمة",
  credential: "كلمة السر",
  normalizedName: "مفتاح المطابقة",
  fee: "رسوم التوصيل",
  version: "رقم النسخة",
  price: "السعر",
  code: "الكود",
  type: "نوع الكود",
  productId: "رقم المنتج",
  productVariantId: "رقم شكل البيع",
  quantity: "الكمية",
  reservedQuantity: "الكمية المحجوزة",
  reserved_quantity: "الكمية المحجوزة",
  lowStockThreshold: "حد التنبيه",
  delta: "الفرق",
  movementType: "نوع الحركة",
  requested: "الكمية المطلوبة",
  actual: "الكمية الفعلية",
  status: "الحالة",
  itemStatus: "حالة الصنف",
  actualQuantity: "الكمية المجهّزة",
  finalTotal: "إجمالي السطر",
  subtotalFinal: "إجمالي الطلب",
  totalFinal: "الإجمالي النهائي",
  title: "العنوان",
};

const PERMISSION_KEYS = new Set(
  PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key)),
);

/** A value that is a known token is shown in words, never as the token. */
function tokenText(value: string): string {
  if (PERMISSION_KEYS.has(value)) return permissionLabel(value);
  if (ROLE_LABELS[value]) return roleDisplayName(value);
  if (SETTING_LABELS[value]) return settingLabel(value);
  if (AUDIT_ENTITY_LABELS[value]) return auditEntityLabel(value);
  if (ORDER_STATUS_LABELS[value]) return orderStatusLabel(value);
  if (MOVEMENT_TYPE_LABELS[value]) return movementTypeLabel(value);
  if (CODE_TYPE_LABELS[value]) return CODE_TYPE_LABELS[value];
  if (ORDER_ITEM_STATUS_LABELS[value]) return itemStatusLabel(value);
  return value;
}

function fieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return "فاضي";
  if (typeof value === "boolean") {
    if (field === "isPrimary") return value ? "أه" : "لأ";
    if (field === "isRegistered") return value ? "مسجّل" : "مش مسجّل";
    return value ? "مفعّل" : "موقوف";
  }
  if (typeof value === "number") return formatQuantity(value);
  if (typeof value === "object") return JSON.stringify(value);
  const text = value as string;
  if (field === "credential") return "تم تعيينها";
  if (field === "role") return tokenText(text);
  if (field === "permission") return tokenText(text);
  if (field === "key") return settingLabel(text);
  if (field === "status") return orderStatusLabel(text);
  if (field === "itemStatus") return itemStatusLabel(text);
  if (field === "movementType") return movementTypeLabel(text);
  if (field === "type") return CODE_TYPE_LABELS[text] ?? "نوع غير معروف";
  if (field === "fee") return formatMoney(text);
  if (field === "quantity" || field === "reservedQuantity" || field === "reserved_quantity") {
    return formatQuantity(text);
  }
  if (field === "normalizedName" || field === "slug" || field === "code" || field === "productId" || field === "productVariantId") {
    return text;
  }
  return tokenText(text);
}

function valueRows(values: unknown): { label: string; value: string }[] {
  if (values === null || values === undefined) return [];
  if (typeof values !== "object" || Array.isArray(values)) {
    return [{ label: "القيمة", value: fieldValue("value", values) }];
  }
  return Object.entries(values as Record<string, unknown>).map(([field, value]) => ({
    label: FIELD_LABELS[field] ?? "غير معروف",
    value: fieldValue(field, value),
  }));
}

export default async function AdminAuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission("audit_logs.view");
  const { id } = await params;
  const row = await getAudit(id).catch(() => null);
  if (!row) notFound();

  const actor = row.user_id
    ? await prisma.user.findFirst({ where: { id: row.user_id }, select: { name: true } }).catch(() => null)
    : null;

  const projected = toAudit(row, admin.permissions);
  // ADM-11 read-time policy: the payload keeps the personal fields, but they
  // are masked unless the reader can already read customer contact data.
  const canSeePii = admin.permissions.includes("customers.view");
  const oldValues = maskAuditValues(projected.oldValues, canSeePii);
  const newValues = maskAuditValues(projected.newValues, canSeePii);
  const masked = !canSeePii && JSON.stringify([oldValues, newValues]) !== JSON.stringify([projected.oldValues, projected.newValues]);
  const before = valueRows(oldValues);
  const after = valueRows(newValues);
  const actionLabel = auditActionText(row.action);

  return (
    <>
      <PageHead
        eyebrow="سجل التغييرات"
        title={actionLabel}
        intro={`سطر واحد من سجل التغييرات: ${actionLabel} في قسم ${auditEntityText(row.entity_type)}. السطر ده اتسجل بعد ما التغيير اتحفظ في المتجر.`}
      />

      <Panel title="ملخص التغيير" sub="مين عمل إيه وإمتى">
        <KeyValue
          items={[
            {
              label: "مين",
              value: row.user_id ? (
                <span className="adm-cell-main">
                  <span className="adm-cell-title">{actor?.name ?? "غير معروف"}</span>
                  <span className="adm-cell-sub">{actorTypeLabel(row.actor_type)}</span>
                </span>
              ) : (
                <span className="adm-cell-main">
                  <span className="adm-cell-title">{actorTypeLabel(row.actor_type)}</span>
                  <span className="adm-cell-sub">مفيش حساب مسجل</span>
                </span>
              ),
            },
            { label: "إيه اللي عمله", value: actionLabel },
            { label: "القسم", value: auditEntityText(row.entity_type) },
            { label: "إمتى", value: formatDateTime(row.created_at) },
            {
              label: "النتيجة",
              value:
                auditActionOutcome(row.action) === "FAILURE" ? (
                  <Pill tone="danger">{auditResultText(row.action)}</Pill>
                ) : (
                  <Pill tone="success">{auditResultText(row.action)}</Pill>
                ),
            },
          ]}
        />
      </Panel>

      <Panel title="القيم قبل التغيير" sub="الحالة اللي كانت عليها الحاجة قبل ما تتعدّل">
        {before.length === 0 ? (
          <EmptyState title="مفيش قيم قبل التغيير" hint="السطر ده بيبدأ حاجة جديدة، فمفيش حالة قبله." />
        ) : (
          <KeyValue items={before.map((entry) => ({ label: entry.label, value: entry.value }))} />
        )}
      </Panel>

      <Panel title="القيم بعد التغيير" sub="الحالة اللي الحاجة سابتها">
        {after.length === 0 ? (
          <EmptyState title="مفيش قيم بعد التغيير" hint="السطر ده بيحذف الحاجة أو بيسجّل محاولة مرفوضة." />
        ) : (
          <KeyValue items={after.map((entry) => ({ label: entry.label, value: entry.value }))} />
        )}
      </Panel>

      <Note tone="info">
        السطر ده اتسجل جوّه نفس عملية الحفظ، فوجوده معناه إن التغيير اتسجل فعلًا في المتجر.
      </Note>

      {masked ? (
        <Note tone="warn">
          القيم الشخصية (البريد والتليفون والاسم) متخفية لأن حسابك مش معاه صلاحية عرض بيانات العملاء. القيمة
          نفسها لسه محفوظة في السجل ومتاحة لصاحب الصلاحية.
        </Note>
      ) : null}

      <details className="adm-panel">
        <summary className="adm-panel-head adm-details-summary">
          <div className="adm-panel-title">التفاصيل التقنية</div>
        </summary>
        <div className="adm-panel-body">
          <div className="adm-table-scroll">
            <pre className="adm-cell-id" dir="ltr">
              {JSON.stringify(
                {
                  action: row.action,
                  entity_type: row.entity_type,
                  entity_id: row.entity_id,
                  actor_type: row.actor_type,
                  ip_address: row.ip_address,
                  user_agent: row.user_agent,
                  old_values: oldValues,
                  new_values: newValues,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </details>
    </>
  );
}
