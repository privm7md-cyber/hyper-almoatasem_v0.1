// ADM-OWNER — customer ANONYMIZATION, final closure + Default-Disabled Design H2 Integration.
//
// OWNER DECISION (12 Nov 2026, final): the approved path for hiding a
// customer's identity is ANONYMIZATION — not deleting the customer with
// everything attached to it. The order history, the money and the
// operational records survive; the identifying data is removed or replaced.
//
// P12-08 D01 ACTIVATION BOUNDARY (18 Nov 2026):
//   • DEFAULT (`CUSTOMER_AUDIT_REDACTION_MODE` unset / !== "H2"):
//     H2 is DISABLED. `anonymizeCustomer()` runs the pre-existing synchronous
//     implementation with zero queries to `customer_audit_redaction_tasks` and
//     zero `pg_notify` calls. On Primary (`hyper_almoatasem`), `P1208-D01`
//     (immutable `audit_logs` trigger vs historical customer audit scrubbing)
//     remains an open database migration + worker activation item until
//     explicitly authorized by the Owner.
//   • WHEN EXPLICITLY ENABLED (`CUSTOMER_AUDIT_REDACTION_MODE=H2`, only after
//     approved H2 DDL migration and isolated worker deployment):
//     `anonymizeCustomer()` never calls `tx.auditLog.update()`. Never-edited
//     and PII-free (`changedFields`-only) customers complete synchronously
//     (`200 OK`, `anonymized: true`), while customers with unredacted
//     historical `audit_logs` PII enqueue a durable task in
//     `customer_audit_redaction_tasks` and return `anonymized: false`
//     (`PENDING_AUDIT_REDACTION` or `FAILED`, `202 Accepted`) until the
//     separate least-privilege `privacy-redaction-worker` completes redaction.
//
// Guest orders are never attached to a customer by this operation.
import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, businessRule, conflict } from "@/lib/api/errors";
import { auditInTx } from "@/lib/api/audit";
import { assertAdminPreviewWritesAllowed } from "@/lib/auth/admin-read-only-preview";

/* ----------------------------------------------------- activation boundary */

export const CUSTOMER_AUDIT_REDACTION_MODE_ENV = "CUSTOMER_AUDIT_REDACTION_MODE";
export const AUDIT_REDACTION_MIGRATION_REQUIRED_CODE =
  "AUDIT_REDACTION_MIGRATION_REQUIRED" as const;

/**
 * Explicit opt-in gate for Hardened Design H2 (`CUSTOMER_AUDIT_REDACTION_MODE=H2`).
 * Strictly `false` (disabled) by default so no unmigrated database or
 * production runtime ever queries `customer_audit_redaction_tasks` or activates
 * the `202 Accepted` contract without separate Owner migration & activation approval.
 */
export function isCustomerAuditRedactionH2Enabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[CUSTOMER_AUDIT_REDACTION_MODE_ENV]?.trim() === "H2";
}

function isAuditRedactionMigrationRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: string;
    message?: string;
    meta?: Record<string, unknown>;
    cause?: unknown;
  };
  const combined = [
    typeof e.code === "string" ? e.code : "",
    typeof e.message === "string" ? e.message : "",
    e.meta ? JSON.stringify(e.meta) : "",
    e.cause && typeof e.cause === "object"
      ? String((e.cause as { message?: unknown }).message ?? "")
      : "",
  ].join(" ");

  if (/audit_logs is append-only/i.test(combined)) return true;
  if (
    /customer_audit_redaction_tasks/i.test(combined) &&
    /(does not exist|42P01|permission denied|42501)/i.test(combined)
  ) {
    return true;
  }
  return false;
}

function migrationRequiredBusinessRuleError(): ApiError {
  return businessRule(
    "تعذّر إخفاء هوية العميل حالياً: توجد قيم تاريخية في سجل التدقيق محمية بقيد عدم التعديل، ولم يتم تفعيل ترحيل وعامل الخصوصية الآمن (H2) على قاعدة البيانات هذه بعد. لم يتم تعديل أي بيانات للعميل.",
    {
      reasonCode: AUDIT_REDACTION_MIGRATION_REQUIRED_CODE,
      anonymized: false,
    },
  );
}

/* ------------------------------------------------------- retention matrix */

export type RetentionAction =
  | "REMOVE"
  | "REPLACE"
  | "RETAIN_OPERATIONAL"
  | "RESTRICTED_RETAINED_PII"
  | "LEGAL_REVIEW_REQUIRED";

export interface RetentionEntry {
  /** The exact place the copy lives (table.column). */
  location: string;
  /** The Arabic name of the data. */
  label: string;
  action: RetentionAction;
  /** Why this action, in one line. */
  reason: string;
  /** True when the copy can still identify the person. */
  restricted: boolean;
  /** For RESTRICTED_RETAINED_PII: who needs it. */
  accessScope?: string;
  /** For RESTRICTED_RETAINED_PII: the permission that governs the access. */
  requiredPermission?: string;
}

/** The generic label the history shows instead of the real name. */
export const ANONYMIZED_DISPLAY_NAME = "عميل مجهول";
/** The generic sentence that replaces a free-text field entirely. */
export const PRIVACY_REMOVED_TEXT = "تمت إزالة البيانات لأسباب الخصوصية";
/**
 * The mode this implementation actually achieves. The technical id and the
 * order links REMAIN (the history must stay coherent), so the records are
 * still linkable to each other — they are pseudonymized, not anonymous.
 */
export const ANONYMIZATION_MODE = "PSEUDONYMIZED" as const;

/**
 * CUSTOMER_DATA_RETENTION_MATRIX — field level, every actual column.
 * Nothing is decided "later": every copy has one action, one reason, and —
 * when it is kept — its access scope and governing permission.
 */
export const CUSTOMER_DATA_RETENTION_MATRIX: RetentionEntry[] = [
  /* ---------------------------------------------------- customer row */
  { location: "customers.first_name", label: "الاسم الأول", action: "REPLACE", reason: "الاسم المباشر بيحدد الشخص — بيتستبدل بـ«عميل مجهول».", restricted: false },
  { location: "customers.last_name", label: "الاسم الأخير", action: "REMOVE", reason: "جزء من الهوية — بيتشال.", restricted: false },
  { location: "customers.phone", label: "رقم التليفون", action: "REPLACE", reason: "مفتاح الربط — بيتستبدل بمعرّف تقني مش راجع للشخص (مش hash للتليفون).", restricted: false },
  { location: "customers.email", label: "البريد الإلكتروني", action: "REMOVE", reason: "بيانات تعريف مباشرة — بيتشال.", restricted: false },
  { location: "customers.password_hash", label: "كلمة السر", action: "REMOVE", reason: "مفيش حساب بعد الإخفاء.", restricted: false },
  { location: "customers.is_registered", label: "علامة الحساب", action: "REPLACE", reason: "الحساب بيقف والعميل بيبقى ضيف بلا هوية.", restricted: false },
  { location: "customers.locked_until", label: "قفل الدخول", action: "REMOVE", reason: "قفل الدخول مرتبط بحساب اتشال.", restricted: false },
  { location: "customers.is_active", label: "تفعيل الحساب", action: "REPLACE", reason: "الحساب بيتوقف — العميل ما يقدرش يدخل ولا يطلب بعد الإخفاء.", restricted: false },
  { location: "customers.deleted_at", label: "علامة الحذف المنطقي", action: "RETAIN_OPERATIONAL", reason: "علامة داخلية بتأثر على العرض فقط — مش بيانات تعريف.", restricted: false },
  { location: "customers.created_at", label: "تاريخ التسجيل", action: "RETAIN_OPERATIONAL", reason: "تاريخ داخلي — مش بيانات تعريف.", restricted: false },

  /* -------------------------------------------------- address book */
  { location: "customer_addresses.label", label: "اسم العنوان المحفوظ", action: "REMOVE", reason: "الصف كله بيتشال — العنوان ما ينفعش يفضل بعد إخفاء الهوية.", restricted: false },
  { location: "customer_addresses.city", label: "مدينة العميل", action: "REMOVE", reason: "من دفتر العناوين — الصف كله بيتشال.", restricted: false },
  { location: "customer_addresses.area", label: "منطقة العميل", action: "REMOVE", reason: "من دفتر العناوين — الصف كله بيتشال.", restricted: false },
  { location: "customer_addresses.village", label: "قرية العميل", action: "REMOVE", reason: "من دفتر العناوين — الصف كله بيتشال.", restricted: false },
  { location: "customer_addresses.street", label: "شارع العميل", action: "REMOVE", reason: "الشارع بيكشف عنوان السكن — الصف كله بيتشال مع إخفاء الهوية.", restricted: false },
  { location: "customer_addresses.building_number", label: "رقم مبنى العميل", action: "REMOVE", reason: "رقم المبنى بيكشف عنوان السكن — الصف كله بيتشال مع إخفاء الهوية.", restricted: false },
  { location: "customer_addresses.landmark", label: "علامة مميزة للعميل", action: "REMOVE", reason: "أقوى مؤشر على العنوان.", restricted: false },
  { location: "customer_addresses.phone", label: "تليفون العميل في العنوان", action: "REMOVE", reason: "بيانات تواصل — الصف كله بيتشال.", restricted: false },
  { location: "customer_addresses.is_default", label: "العنوان الافتراضي", action: "REMOVE", reason: "من دفتر العناوين — الصف كله بيتشال.", restricted: false },

  /* ------------------------------------------------------- sessions */
  { location: "customer_sessions.token_hash", label: "تجزئة جلسة الدخول", action: "REMOVE", reason: "الجلسة بتسمح بالدخول — بتلغى مع الإخفاء.", restricted: false },
  { location: "customer_sessions.created_ip", label: "IP إنشاء الجلسة", action: "REMOVE", reason: "مؤشر اتصال — الصف كله بيتشال.", restricted: false },
  { location: "customer_sessions.user_agent", label: "متصفح الجلسة", action: "REMOVE", reason: "بصمة جهاز — الصف كله بيتشال.", restricted: false },

  /* -------------------------------------------- rate limit buckets */
  { location: "customer_auth_rate_limits.bucket_key", label: "مفاتيح حد المحاولات", action: "REMOVE", reason: "المفاتيح المشتقة من التليفون (خام أو hash) بتتسم — الحد بيتحسب من جديد.", restricted: false },

  /* ----------------------------------------------- order snapshots */
  { location: "orders.customer_name_snapshot", label: "اسم العميل في الطلب", action: "REPLACE", reason: "نسخة الاسم جوه الطلب بتستبدل — الطلب نفسه ما بيتشالش.", restricted: false },
  { location: "orders.customer_phone_snapshot", label: "تليفون العميل في الطلب", action: "REPLACE", reason: "العمود NOT NULL — بيتستبدل بمعرّف تقني غير قابل للاتصال (مش صفر ولا تليفون).", restricted: false },

  /* -------------------------------------------- delivery address (order) */
  { location: "orders.delivery_phone", label: "تليفون المستلم", action: "REPLACE", reason: "بيانات تواصل — الطلب المكتمل مش محتاج تليفون المستلم.", restricted: false },
  { location: "orders.delivery_street", label: "شارع المستلم", action: "REMOVE", reason: "عنوان منزل — انتهت الحاجة التشغيلية بانتهاء الطلب.", restricted: false },
  { location: "orders.delivery_building", label: "رقم مبنى المستلم", action: "REMOVE", reason: "عنوان منزل — انتهت الحاجة التشغيلية بانتهاء الطلب.", restricted: false },
  { location: "orders.delivery_landmark", label: "علامة مميزة للمستلم", action: "REMOVE", reason: "أقوى مؤشر على العنوان.", restricted: false },
  { location: "orders.delivery_village", label: "قرية المستلم", action: "REMOVE", reason: "تحديد دقيق للمكان — لا يُحتفظ به.", restricted: false },
  { location: "orders.delivery_area", label: "منطقة المستلم", action: "REMOVE", reason: "المدينة تكفي للتجميع التشغيلي؛ المنطقة تضيّق الموقع وتسمح بإعادة التعرف.", restricted: false },
  {
    location: "orders.delivery_city",
    label: "مدينة المستلم",
    action: "RETAIN_OPERATIONAL",
    reason: "المدينة/المركز مستوى إداري واسع: لا يحدد الشخص وحده، ويلزم للتجميع التشغيلي (رسوم التوصيل والمناطق).",
    restricted: false,
  },
  {
    location: "orders.notes",
    label: "ملاحظات الطلب الحرة",
    action: "REPLACE",
    reason: "نص حر: لا يمكن إزالة الهوية منه بشكل موثوق — النص كله بيستبدل بجملة عامة.",
    restricted: false,
  },

  /* ------------------------------------------------- order operations */
  { location: "orders.id, order_number, status, created_at", label: "بيانات الطلب التشغيلية", action: "RETAIN_OPERATIONAL", reason: "سجل تشغيلي — ما يتغيرش.", restricted: false },
  { location: "order_items.*", label: "بنود الطلب والأسعار والخصومات", action: "RETAIN_OPERATIONAL", reason: "تاريخ تجاري ومالي — ما يتغيرش أبدًا.", restricted: false },
  { location: "orders.subtotal_*, total_*, delivery_fee, discount_total", label: "إجماليات الطلب", action: "RETAIN_OPERATIONAL", reason: "سجل مالي — ما يتغيرش أبدًا.", restricted: false },
  { location: "inventory_movements.*", label: "حركات المخزون", action: "RETAIN_OPERATIONAL", reason: "سجل تشغيلي ومخزني — ما يتأثرش بإخفاء الهوية.", restricted: false },
  { location: "order_discounts.*, coupon_usages.*", label: "سجل الخصومات والكوبونات", action: "RETAIN_OPERATIONAL", reason: "سجل مالي — بيتربط بالمعرّف التقني بس.", restricted: false },

  /* -------------------------------------------------- technical links */
  { location: "orders.customer_id, carts.customer_id, coupon_usages.customer_id", label: "الربط الفني بالعميل", action: "RETAIN_OPERATIONAL", reason: "المعرّف الداخلي لازم يفضل عشان السجلات تفضل متماسكة — من غير أي وسيلة ترجّع الهوية.", restricted: false },

  /* ------------------------------------------------------ audit trail */
  { location: "audit_logs.old_values / new_values (صفوف العميل)", label: "قيم سجل تدقيق العميل", action: "REMOVE", reason: "سجل التدقيق بيقدّم الأثر بس — القيم الشخصية بتتنقّى.", restricted: false },
  { location: "audit_logs (سطر عملية الإخفاء)", label: "سطر عملية الإخفاء", action: "RETAIN_OPERATIONAL", reason: "مين عمل العملية وإمتى وليه — من غير أي نسخة من البيانات الشخصية.", restricted: false },

  /* ----------------------------------------------- legal open items */
  {
    location: "backups / replicas / logs خارج قاعدة البيانات",
    label: "النسخ الاحتياطية والسجلات الخارجية",
    action: "LEGAL_REVIEW_REQUIRED",
    reason: "العملية بتشتغل على قاعدة البيانات بس؛ النسخ الاحتياطية والسجلات الخارجية خارج نطاقها ومحدش يقدر يفرض على النظام يمسحها. المسح منها محتاج قرار قانوني/تشغيلي منفصل.",
    restricted: true,
    accessScope: "مالك المتجر + المسؤول القانوني",
    requiredPermission: "audit_logs.view",
  },
  {
    location: "customer_auth_rate_limits (مفاتيح HMAC للتسجيل)",
    label: "مفاتيح حد التسجيل المشتقة بـHMAC",
    action: "LEGAL_REVIEW_REQUIRED",
    reason: "مفتاح التسجيل HMAC بمفتاح سري مستقل — مش قابل للحساب بدون السر، فمش بيشتغل عليه الاستهداف المباشر. الصفوف دي TTL-pruned. لو المسح مطلوب، محتاج قرار منفصل.",
    restricted: true,
    accessScope: "مالك المتجر + المسؤول القانوني",
    requiredPermission: "audit_logs.view",
  },
];

/* --------------------------------------------------------------- inputs */

export const anonymizeInputSchema = z
  .object({
    confirmed: z.literal(true),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(
        (v) => !v.includes("@") && !/\d{7,}/.test(v),
        "reason must not contain email addresses or phone numbers",
      ),
    /** The concurrency token: the customer's updatedAt when it was read. */
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type AnonymizeInput = z.infer<typeof anonymizeInputSchema>;

/* ------------------------------------------------------------- helpers */

/**
 * A non-reversible placeholder for the phone: derived from the customer's
 * TECHNICAL id, never from the phone itself, so it cannot be reversed and
 * cannot be used to recognise the person.
 *
 * P1208-D03: Must also satisfy the frozen PostgreSQL CHECK constraint
 * `^[0-9]{8,15}$` on `customers.phone`, `orders.customer_phone_snapshot`,
 * and `orders.delivery_phone` while remaining outside the routable customer
 * identity space (`^201[0125][0-9]{8}$`) and avoiding UUIDv7 timestamp-prefix
 * collisions. Uses `000` + 12 deterministic digits from SHA-256(customerId).
 */
export function anonymousPhonePlaceholder(customerId: string): string {
  const digestHex = createHash("sha256")
    .update(`anon-customer:${customerId.toLowerCase()}`)
    .digest("hex")
    .slice(0, 12);
  const tail = (Number.parseInt(digestHex, 16) % 1_000_000_000_000)
    .toString(10)
    .padStart(12, "0");
  return `000${tail}`;
}

/**
 * The rate-limit scope hash (mirrors `shortScopeHash` in lib/auth/rate-limit.ts
 * — the same 24 hex characters of SHA-256).
 */
export function phoneScopeHash(canonicalPhone: string): string {
  return createHash("sha256").update(canonicalPhone).digest("hex").slice(0, 24);
}

/**
 * The audit values of a customer action, with the identifying values gone.
 * Used by the default legacy path (`CUSTOMER_AUDIT_REDACTION_MODE !== "H2"`).
 */
export function scrubAuditValues(values: unknown): unknown {
  if (values === null || values === undefined) return values;
  if (typeof values === "string") return values;
  if (Array.isArray(values)) return values.map(scrubAuditValues);
  if (typeof values === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (/phone|email|password|token|secret|name|address|landmark|street|building|village|area|note/i.test(key)) {
        out[key] = PRIVACY_REMOVED_TEXT;
        continue;
      }
      out[key] = scrubAuditValues(value);
    }
    return out;
  }
  return values;
}

const ALLOWED_CUSTOMER_CHANGED_FIELDS = new Set([
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "email",
  "autoAcceptReplacements",
  "auto_accept_replacements",
  "isActive",
  "is_active",
]);

const ALLOWED_CUSTOMER_BOOL_KEYS = new Set([
  "isregistered",
  "is_registered",
  "isactive",
  "is_active",
  "autoacceptreplacements",
  "auto_accept_replacements",
]);

/**
 * Fail-closed 5-key non-PII allowlist check mirroring PostgreSQL
 * `public.scrub_customer_audit_jsonb(jsonb)` in Hardened Design H2.
 * Returns `true` if ANY key or scalar in `val` is outside the typed non-PII
 * allowlist and has not yet been replaced with `PRIVACY_REMOVED_TEXT`.
 */
export function hasUnredactedCustomerAuditPii(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (val === PRIVACY_REMOVED_TEXT) return false;

  if (Array.isArray(val)) {
    return val.some((elem) => {
      if (elem === null || elem === PRIVACY_REMOVED_TEXT) return false;
      if (typeof elem === "object") return hasUnredactedCustomerAuditPii(elem);
      return true;
    });
  }

  if (typeof val === "object") {
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      if (value === null || value === PRIVACY_REMOVED_TEXT) continue;
      const lk = key.toLowerCase();

      if (ALLOWED_CUSTOMER_BOOL_KEYS.has(lk) && typeof value === "boolean") {
        continue;
      }
      if (
        lk === "correlation_id" &&
        typeof value === "string" &&
        !value.includes("@") &&
        /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,63}$/.test(value)
      ) {
        continue;
      }
      if (
        (lk === "changedfields" || lk === "changed_fields") &&
        Array.isArray(value) &&
        value.every((item) => typeof item === "string" && ALLOWED_CUSTOMER_CHANGED_FIELDS.has(item))
      ) {
        continue;
      }
      if (typeof value === "object") {
        if (hasUnredactedCustomerAuditPii(value)) return true;
        continue;
      }
      return true;
    }
    return false;
  }

  return true;
}

/** The order statuses that are still in flight. */
export const OPEN_ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"];

/* ---------------------------------------------------------- the operation */

export interface AnonymizeResult {
  anonymized: boolean;
  /**
   * Default mode: COMPLETED | REFUSED | COMPLETED_WITH_LEGAL_REVIEW.
   * H2 mode (`CUSTOMER_AUDIT_REDACTION_MODE=H2`): also supports
   * PENDING_AUDIT_REDACTION (`anonymized: false`) and FAILED (`anonymized: false`).
   */
  outcome:
    | "COMPLETED"
    | "REFUSED"
    | "COMPLETED_WITH_LEGAL_REVIEW"
    | "PENDING_AUDIT_REDACTION"
    | "FAILED";
  /** PSEUDONYMIZED — the technical link stays; the identity does not. */
  mode: typeof ANONYMIZATION_MODE;
  customerId: string;
  displayName: string;
  auditRedactionPending?: boolean;
  redactionTaskId?: string | null;
  attemptCount?: number;
  lastErrorCode?: string | null;
  /** What was removed / replaced. */
  removed: {
    addresses: number;
    sessions: number;
    rateLimitBuckets: number;
    auditRows: number;
    orderRows: number;
  };
  /** The order statuses that blocked the operation (empty when it ran). */
  blockedByOpenOrders: string[];
  /** The copies that stay, with their access scope and governing permission. */
  restrictedRetained: Array<{
    location: string;
    label: string;
    accessScope: string;
    requiredPermission: string;
  }>;
  /** True when the customer was already anonymized (a safe repeat). */
  alreadyAnonymized: boolean;
}

export interface CustomerAnonymizeStatusResponse {
  state: "NOT_ANONYMIZED" | "PENDING_AUDIT_REDACTION" | "FAILED" | "COMPLETED";
  customerId: string;
  anonymized: boolean;
  result: AnonymizeResult | null;
}

interface RedactionTaskRow {
  id: string;
  status: "PENDING" | "FAILED" | "COMPLETED";
  attempt_count: number;
  redacted_audit_rows: number | null;
  last_error_code: string | null;
}

function buildRestrictedRetained() {
  return CUSTOMER_DATA_RETENTION_MATRIX.filter((entry) => entry.restricted).map((entry) => ({
    location: entry.location,
    label: entry.label,
    accessScope: entry.accessScope ?? "مالك المتجر",
    requiredPermission: entry.requiredPermission ?? "audit_logs.view",
  }));
}

/**
 * Read-only inspection of a customer's H2 anonymization & durable audit-redaction
 * task status. Strictly inactive (`returns null` or caller gates before calling)
 * unless `isCustomerAuditRedactionH2Enabled()` is `true`. Never returns PII.
 */
export async function getCustomerAnonymizeStatus(
  customerId: string,
): Promise<CustomerAnonymizeStatusResponse | null> {
  if (!isCustomerAuditRedactionH2Enabled()) {
    return null;
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      passwordHash: true,
      isRegistered: true,
      isActive: true,
      deletedAt: true,
    },
  });
  if (!customer) return null;

  const placeholder = anonymousPhonePlaceholder(customer.id);
  const operationalAnonymized =
    customer.firstName === ANONYMIZED_DISPLAY_NAME &&
    customer.phone === placeholder &&
    customer.lastName === null &&
    customer.email === null &&
    customer.passwordHash === null &&
    !customer.isRegistered &&
    !customer.isActive &&
    customer.deletedAt !== null;

  if (!operationalAnonymized) {
    return {
      state: "NOT_ANONYMIZED",
      customerId: customer.id,
      anonymized: false,
      result: null,
    };
  }

  let tasks: RedactionTaskRow[];
  let auditRows: Array<{ id: string; action: string; oldValues: unknown; newValues: unknown }>;
  let orderCount: number;
  try {
    [tasks, auditRows, orderCount] = await Promise.all([
      prisma.$queryRaw<RedactionTaskRow[]>`
        SELECT id::text AS id,
               status::text AS status,
               attempt_count,
               redacted_audit_rows,
               last_error_code
          FROM customer_audit_redaction_tasks
         WHERE customer_id = ${customerId}::uuid
         ORDER BY created_at DESC
         LIMIT 1
      `,
      prisma.auditLog.findMany({
        where: { entityType: "customers", entityId: customerId },
        select: { id: true, action: true, oldValues: true, newValues: true },
      }),
      prisma.order.count({ where: { customerId } }),
    ]);
  } catch (error) {
    if (isAuditRedactionMigrationRequiredError(error)) {
      throw migrationRequiredBusinessRuleError();
    }
    throw error;
  }

  const historicalRows = auditRows.filter(
    (row) => !row.action || row.action === "customers.update" || row.action === "customers.register",
  );
  const hasUnredacted = historicalRows.some(
    (row) => hasUnredactedCustomerAuditPii(row.oldValues) || hasUnredactedCustomerAuditPii(row.newValues),
  );

  const latestTask = tasks[0] ?? null;
  const restricted = buildRestrictedRetained();

  if (latestTask?.status === "FAILED") {
    return {
      state: "FAILED",
      customerId: customer.id,
      anonymized: false,
      result: {
        anonymized: false,
        outcome: "FAILED",
        mode: ANONYMIZATION_MODE,
        customerId: customer.id,
        displayName: ANONYMIZED_DISPLAY_NAME,
        auditRedactionPending: true,
        redactionTaskId: latestTask.id,
        attemptCount: latestTask.attempt_count,
        lastErrorCode: latestTask.last_error_code ?? "WORKER_EXECUTION_ERROR",
        removed: {
          addresses: 0,
          sessions: 0,
          rateLimitBuckets: 0,
          auditRows: 0,
          orderRows: orderCount,
        },
        blockedByOpenOrders: [],
        restrictedRetained: restricted,
        alreadyAnonymized: true,
      },
    };
  }

  if (latestTask?.status === "PENDING" || hasUnredacted) {
    return {
      state: "PENDING_AUDIT_REDACTION",
      customerId: customer.id,
      anonymized: false,
      result: {
        anonymized: false,
        outcome: "PENDING_AUDIT_REDACTION",
        mode: ANONYMIZATION_MODE,
        customerId: customer.id,
        displayName: ANONYMIZED_DISPLAY_NAME,
        auditRedactionPending: true,
        redactionTaskId: latestTask?.id ?? null,
        attemptCount: latestTask?.attempt_count ?? 0,
        lastErrorCode: null,
        removed: {
          addresses: 0,
          sessions: 0,
          rateLimitBuckets: 0,
          auditRows: 0,
          orderRows: orderCount,
        },
        blockedByOpenOrders: [],
        restrictedRetained: restricted,
        alreadyAnonymized: true,
      },
    };
  }

  const finalOutcome = restricted.length > 0 ? "COMPLETED_WITH_LEGAL_REVIEW" : "COMPLETED";
  return {
    state: "COMPLETED",
    customerId: customer.id,
    anonymized: true,
    result: {
      anonymized: true,
      outcome: finalOutcome,
      mode: ANONYMIZATION_MODE,
      customerId: customer.id,
      displayName: ANONYMIZED_DISPLAY_NAME,
      auditRedactionPending: false,
      redactionTaskId: latestTask?.id ?? null,
      attemptCount: latestTask?.attempt_count ?? 0,
      lastErrorCode: null,
      removed: {
        addresses: 0,
        sessions: 0,
        rateLimitBuckets: 0,
        auditRows: latestTask?.redacted_audit_rows ?? historicalRows.length,
        orderRows: orderCount,
      },
      blockedByOpenOrders: [],
      restrictedRetained: restricted,
      alreadyAnonymized: true,
    },
  };
}

/**
 * Anonymize one customer.
 * - Default (`CUSTOMER_AUDIT_REDACTION_MODE !== "H2"`): preserves the exact
 *   pre-existing implementation (no H2 queue tables touched, no `202` activated).
 * - H2 Mode (`CUSTOMER_AUDIT_REDACTION_MODE === "H2"`): never executes
 *   `tx.auditLog.update()`, enqueues durable tasks for historical customer audit
 *   PII, and returns `PENDING_AUDIT_REDACTION` / `FAILED` (`anonymized: false`)
 *   until the isolated worker confirms redaction.
 */
export async function anonymizeCustomer(
  id: string,
  input: AnonymizeInput,
  actorId: string,
  adminSessionId?: string,
  options?: { waitForWorkerMs?: number },
): Promise<AnonymizeResult> {
  assertAdminPreviewWritesAllowed();
  const parsed = anonymizeInputSchema.safeParse(input);
  if (!parsed.success) throw new ApiError("VALIDATION", "Invalid anonymization request.", null);

  const h2Enabled = isCustomerAuditRedactionH2Enabled();

  if (!h2Enabled) {
    // -------------------------------------------------------------------------
    // DEFAULT LEGACY PATH (H2 DISABLED — UNCHANGED PRODUCTION-BOUND BEHAVIOR)
    // -------------------------------------------------------------------------
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked.length) throw new ApiError("NOT_FOUND", "Customer not found.", null);

      const customer = await tx.customer.findUnique({
        where: { id },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          passwordHash: true,
          isRegistered: true,
          lockedUntil: true,
          isActive: true,
          deletedAt: true,
          updatedAt: true,
        },
      });
      if (!customer) throw new ApiError("NOT_FOUND", "Customer not found.", null);
      if (Date.parse(parsed.data.expectedUpdatedAt) !== customer.updatedAt.getTime()) {
        throw conflict("Customer was modified concurrently; re-read and retry.", {
          currentUpdatedAt: customer.updatedAt.toISOString(),
        });
      }

      const placeholder = anonymousPhonePlaceholder(customer.id);
      const alreadyAnonymized =
        customer.firstName === ANONYMIZED_DISPLAY_NAME && customer.phone === placeholder;

      const openOrders = await tx.order.findMany({
        where: { customerId: id, status: { in: OPEN_ORDER_STATUSES } },
        select: { orderNumber: true, status: true },
      });
      if (openOrders.length > 0) {
        throw businessRule(
          `مفيش إخفاء هوية دلوقتي: فيه ${openOrders.length} طلب لسه مفتوح (${openOrders
            .map((order) => order.orderNumber)
            .join("، ")}). استنى الطلب يخلص وارجع تاني.`,
          { openOrders: openOrders.map((order) => order.orderNumber) },
        );
      }

      await tx.customer.update({
        where: { id },
        data: {
          firstName: ANONYMIZED_DISPLAY_NAME,
          lastName: null,
          phone: placeholder,
          email: null,
          passwordHash: null,
          isRegistered: false,
          lockedUntil: null,
          isActive: false,
          deletedAt: customer.deletedAt ?? new Date(),
        },
      });

      const addresses = await tx.customerAddress.deleteMany({ where: { customerId: id } });
      const sessions = await tx.customerSession.deleteMany({ where: { customerId: id } });
      const scopeHash = phoneScopeHash(customer.phone);
      const buckets = await tx.$queryRaw<Array<{ count: number }>>`
        WITH removed AS (
          DELETE FROM customer_auth_rate_limits
          WHERE bucket_key = ${`login:cust-acct:${customer.phone}`}
             OR bucket_key = ${`identify:cust-phone:${scopeHash}`}
             OR bucket_key = ${`identify:cust-ip:target:${scopeHash}`}
             OR bucket_key = ${`reg:cust-ip:target:${scopeHash}`}
          RETURNING 1
        ) SELECT count(*)::int AS count FROM removed`;

      const orders = await tx.order.findMany({
        where: { customerId: id },
        select: { id: true, notes: true },
      });
      for (const order of orders) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            customerNameSnapshot: ANONYMIZED_DISPLAY_NAME,
            customerPhoneSnapshot: placeholder,
            deliveryPhone: placeholder,
            deliveryStreet: null,
            deliveryBuilding: null,
            deliveryLandmark: null,
            deliveryVillage: null,
            deliveryArea: null,
            ...(order.notes ? { notes: PRIVACY_REMOVED_TEXT } : {}),
          },
        });
      }

      const auditRows = await tx.auditLog.findMany({
        where: { entityType: "customers", entityId: id },
        select: { id: true, action: true, oldValues: true, newValues: true },
      });
      for (const row of auditRows) {
        if (
          row.action !== "customers.anonymize" &&
          row.action !== "customers.audit_redact" &&
          (hasUnredactedCustomerAuditPii(row.oldValues) ||
            hasUnredactedCustomerAuditPii(row.newValues))
        ) {
          await tx.auditLog.update({
            where: { id: row.id },
            data: {
              oldValues: scrubAuditValues(row.oldValues) as never,
              newValues: scrubAuditValues(row.newValues) as never,
            },
          });
        }
      }

      await auditInTx(tx, {
        action: "customers.anonymize",
        userId: actorId,
        entityType: "customers",
        entityId: id,
        oldValues: null,
        newValues: {
          displayName: ANONYMIZED_DISPLAY_NAME,
          mode: ANONYMIZATION_MODE,
          removed: {
            addresses: addresses.count,
            sessions: sessions.count,
            rateLimitBuckets: buckets[0]?.count ?? 0,
            auditRows: auditRows.length,
            orderRows: orders.length,
          },
        },
        reason: parsed.data.reason,
      });

      const restricted = buildRestrictedRetained();
      const legacyOutcome: AnonymizeResult["outcome"] =
        restricted.length > 0 ? "COMPLETED_WITH_LEGAL_REVIEW" : "COMPLETED";
      return {
        anonymized: true,
        outcome: legacyOutcome,
        mode: ANONYMIZATION_MODE,
        customerId: id,
        displayName: ANONYMIZED_DISPLAY_NAME,
        removed: {
          addresses: addresses.count,
          sessions: sessions.count,
          rateLimitBuckets: buckets[0]?.count ?? 0,
          auditRows: auditRows.length,
          orderRows: orders.length,
        },
        blockedByOpenOrders: [],
        restrictedRetained: restricted,
        alreadyAnonymized,
      };
    }).catch((error: unknown) => {
      if (isAuditRedactionMigrationRequiredError(error)) {
        throw migrationRequiredBusinessRuleError();
      }
      throw error;
    });
  }

  // ---------------------------------------------------------------------------
  // HARDENED DESIGN H2 PATH (OPT-IN ONLY: `CUSTOMER_AUDIT_REDACTION_MODE=H2`)
  // ---------------------------------------------------------------------------
  const txOutcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
    if (!locked.length) throw new ApiError("NOT_FOUND", "Customer not found.", null);

    const customer = await tx.customer.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        passwordHash: true,
        isRegistered: true,
        lockedUntil: true,
        isActive: true,
        deletedAt: true,
        updatedAt: true,
      },
    });
    if (!customer) throw new ApiError("NOT_FOUND", "Customer not found.", null);
    if (Date.parse(parsed.data.expectedUpdatedAt) !== customer.updatedAt.getTime()) {
      throw conflict("Customer was modified concurrently; re-read and retry.", {
        currentUpdatedAt: customer.updatedAt.toISOString(),
      });
    }

    const placeholder = anonymousPhonePlaceholder(customer.id);
    const alreadyAnonymized =
      customer.firstName === ANONYMIZED_DISPLAY_NAME && customer.phone === placeholder;

    const openOrders = await tx.order.findMany({
      where: { customerId: id, status: { in: OPEN_ORDER_STATUSES } },
      select: { orderNumber: true, status: true },
    });
    if (openOrders.length > 0) {
      throw businessRule(
        `مفيش إخفاء هوية دلوقتي: فيه ${openOrders.length} طلب لسه مفتوح (${openOrders
          .map((order) => order.orderNumber)
          .join("، ")}). استنى الطلب يخلص وارجع تاني.`,
        { openOrders: openOrders.map((order) => order.orderNumber) },
      );
    }

    await tx.customer.update({
      where: { id },
      data: {
        firstName: ANONYMIZED_DISPLAY_NAME,
        lastName: null,
        phone: placeholder,
        email: null,
        passwordHash: null,
        isRegistered: false,
        lockedUntil: null,
        isActive: false,
        deletedAt: customer.deletedAt ?? new Date(),
      },
    });

    const addresses = await tx.customerAddress.deleteMany({ where: { customerId: id } });
    const sessions = await tx.customerSession.deleteMany({ where: { customerId: id } });
    const scopeHash = phoneScopeHash(customer.phone);
    const buckets = await tx.$queryRaw<Array<{ count: number }>>`
      WITH removed AS (
        DELETE FROM customer_auth_rate_limits
        WHERE bucket_key = ${`login:cust-acct:${customer.phone}`}
           OR bucket_key = ${`identify:cust-phone:${scopeHash}`}
           OR bucket_key = ${`identify:cust-ip:target:${scopeHash}`}
           OR bucket_key = ${`reg:cust-ip:target:${scopeHash}`}
        RETURNING 1
      ) SELECT count(*)::int AS count FROM removed`;

    const orders = await tx.order.findMany({
      where: { customerId: id },
      select: { id: true, notes: true },
    });
    for (const order of orders) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          customerNameSnapshot: ANONYMIZED_DISPLAY_NAME,
          customerPhoneSnapshot: placeholder,
          deliveryPhone: placeholder,
          deliveryStreet: null,
          deliveryBuilding: null,
          deliveryLandmark: null,
          deliveryVillage: null,
          deliveryArea: null,
          ...(order.notes ? { notes: PRIVACY_REMOVED_TEXT } : {}),
        },
      });
    }

    const allCustomerAuditRows = await tx.auditLog.findMany({
      where: { entityType: "customers", entityId: id },
      select: { id: true, action: true, oldValues: true, newValues: true },
    });
    const historicalRows = allCustomerAuditRows.filter(
      (row) => !row.action || row.action === "customers.update" || row.action === "customers.register",
    );
    const unredactedRows = historicalRows.filter(
      (row) => hasUnredactedCustomerAuditPii(row.oldValues) || hasUnredactedCustomerAuditPii(row.newValues),
    );
    const needsWorkerRedaction = unredactedRows.length > 0;

    if (needsWorkerRedaction && !adminSessionId) {
      throw new ApiError(
        "UNAUTHENTICATED",
        "Valid admin session required to enqueue historical audit redaction.",
        null,
      );
    }

    await auditInTx(tx, {
      action: "customers.anonymize",
      userId: actorId,
      entityType: "customers",
      entityId: id,
      oldValues: null,
      newValues: {
        displayName: ANONYMIZED_DISPLAY_NAME,
        mode: ANONYMIZATION_MODE,
        auditRedactionPending: needsWorkerRedaction,
        removed: {
          addresses: addresses.count,
          sessions: sessions.count,
          rateLimitBuckets: buckets[0]?.count ?? 0,
          auditRows: needsWorkerRedaction ? 0 : historicalRows.length,
          orderRows: orders.length,
        },
      },
      reason: parsed.data.reason,
    });

    let activeTask: RedactionTaskRow | null = null;
    if (needsWorkerRedaction && adminSessionId) {
      const latestAudit = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
          FROM audit_logs
         WHERE entity_type = 'customers'
           AND entity_id = ${id}::uuid
           AND action = 'customers.anonymize'
           AND user_id = ${actorId}::uuid
         ORDER BY created_at DESC
         LIMIT 1`;
      const anonymizeAuditId = latestAudit[0]?.id;
      if (!anonymizeAuditId) {
        throw new ApiError("INTERNAL", "Failed to locate customers.anonymize audit record.", null);
      }

      const enq = await tx.$queryRaw<RedactionTaskRow[]>`
        INSERT INTO customer_audit_redaction_tasks (
          customer_id, anonymize_audit_id, requested_by_user_id, requested_by_session_id, status
        )
        VALUES (${id}::uuid, ${anonymizeAuditId}::uuid, ${actorId}::uuid, ${adminSessionId}::uuid, 'PENDING')
        ON CONFLICT (customer_id) WHERE status IN ('PENDING', 'FAILED') DO NOTHING
        RETURNING id::text AS id,
                  status::text AS status,
                  attempt_count,
                  redacted_audit_rows,
                  last_error_code`;

      if (enq[0]) {
        activeTask = enq[0];
      } else {
        const existing = await tx.$queryRaw<RedactionTaskRow[]>`
          SELECT id::text AS id,
                 status::text AS status,
                 attempt_count,
                 redacted_audit_rows,
                 last_error_code
            FROM customer_audit_redaction_tasks
           WHERE customer_id = ${id}::uuid
             AND status IN ('PENDING', 'FAILED')
           LIMIT 1`;
        activeTask = existing[0] ?? null;
      }

      if (activeTask?.status === "PENDING") {
        await tx.$queryRaw`SELECT pg_notify('customer_audit_redaction_ready', ${activeTask.id}::text)::text AS notified`;
      }
    }

    return {
      needsWorkerRedaction,
      activeTask,
      historicalAuditCount: historicalRows.length,
      removedBase: {
        addresses: addresses.count,
        sessions: sessions.count,
        rateLimitBuckets: buckets[0]?.count ?? 0,
        orderRows: orders.length,
      },
      alreadyAnonymized,
    };
  }).catch((error: unknown) => {
    if (isAuditRedactionMigrationRequiredError(error)) {
      throw migrationRequiredBusinessRuleError();
    }
    throw error;
  });

  const restricted = buildRestrictedRetained();
  const finalCompletedOutcome = restricted.length > 0 ? "COMPLETED_WITH_LEGAL_REVIEW" : "COMPLETED";

  if (!txOutcome.needsWorkerRedaction) {
    return {
      anonymized: true,
      outcome: finalCompletedOutcome,
      mode: ANONYMIZATION_MODE,
      customerId: id,
      displayName: ANONYMIZED_DISPLAY_NAME,
      auditRedactionPending: false,
      redactionTaskId: null,
      attemptCount: 0,
      lastErrorCode: null,
      removed: {
        ...txOutcome.removedBase,
        auditRows: txOutcome.historicalAuditCount,
      },
      blockedByOpenOrders: [],
      restrictedRetained: restricted,
      alreadyAnonymized: txOutcome.alreadyAnonymized,
    };
  }

  let currentTask = txOutcome.activeTask;
  const waitMs = Math.max(
    0,
    Math.min(
      5_000,
      options?.waitForWorkerMs ?? (Number.parseInt(process.env.PRIVACY_REDACTION_SYNC_WAIT_MS ?? "0", 10) || 0),
    ),
  );

  if (waitMs > 0 && currentTask?.id && currentTask.status === "PENDING") {
    const taskIdToPoll: string = currentTask.id;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40));
      const polled: RedactionTaskRow[] = await prisma.$queryRaw<RedactionTaskRow[]>`
        SELECT id::text AS id,
               status::text AS status,
               attempt_count,
               redacted_audit_rows,
               last_error_code
          FROM customer_audit_redaction_tasks
         WHERE id = ${taskIdToPoll}::uuid`;
      if (polled[0]) {
        currentTask = polled[0];
        if (polled[0].status === "COMPLETED" || polled[0].status === "FAILED") {
          break;
        }
      }
    }
  }

  if (currentTask?.status === "COMPLETED") {
    return {
      anonymized: true,
      outcome: finalCompletedOutcome,
      mode: ANONYMIZATION_MODE,
      customerId: id,
      displayName: ANONYMIZED_DISPLAY_NAME,
      auditRedactionPending: false,
      redactionTaskId: currentTask.id,
      attemptCount: currentTask.attempt_count,
      lastErrorCode: null,
      removed: {
        ...txOutcome.removedBase,
        auditRows: currentTask.redacted_audit_rows ?? txOutcome.historicalAuditCount,
      },
      blockedByOpenOrders: [],
      restrictedRetained: restricted,
      alreadyAnonymized: txOutcome.alreadyAnonymized,
    };
  }

  if (currentTask?.status === "FAILED") {
    return {
      anonymized: false,
      outcome: "FAILED",
      mode: ANONYMIZATION_MODE,
      customerId: id,
      displayName: ANONYMIZED_DISPLAY_NAME,
      auditRedactionPending: true,
      redactionTaskId: currentTask.id,
      attemptCount: currentTask.attempt_count,
      lastErrorCode: currentTask.last_error_code ?? "WORKER_EXECUTION_ERROR",
      removed: {
        ...txOutcome.removedBase,
        auditRows: 0,
      },
      blockedByOpenOrders: [],
      restrictedRetained: restricted,
      alreadyAnonymized: txOutcome.alreadyAnonymized,
    };
  }

  return {
    anonymized: false,
    outcome: "PENDING_AUDIT_REDACTION",
    mode: ANONYMIZATION_MODE,
    customerId: id,
    displayName: ANONYMIZED_DISPLAY_NAME,
    auditRedactionPending: true,
    redactionTaskId: currentTask?.id ?? null,
    attemptCount: currentTask?.attempt_count ?? 0,
    lastErrorCode: null,
    removed: {
      ...txOutcome.removedBase,
      auditRows: 0,
    },
    blockedByOpenOrders: [],
    restrictedRetained: restricted,
    alreadyAnonymized: txOutcome.alreadyAnonymized,
  };
}
