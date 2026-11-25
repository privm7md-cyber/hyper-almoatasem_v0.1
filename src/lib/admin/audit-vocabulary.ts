// ============================================================================
// AUDIT VOCABULARY — every action the store writes, and the field policy
// ============================================================================
// ADM-11: the audit filter offered 61 actions while the store writes 68, so
// seven real actions (product lifecycle, image primary/update, customer
// anonymization, account lockout) were unfilterable and rendered as
// "عمل غير معروف". The vocabulary below is the SINGLE list: the filter, the
// labels, the outcome classification and the sensitivity flag all come from
// it, so a new action can never be invisible.
//
// It also carries the FIELD POLICY for the audit payloads:
//   • FORBIDDEN — never stored (the write-time sanitiser drops these);
//   • MASKED    — stored, but hidden from a reader without the customer
//                 capability (the values are still there for the accountable
//                 reader);
//   • PLAIN     — stored and shown as is.
// ============================================================================

export type AuditOutcome = "SUCCESS" | "FAILURE";

export interface AuditActionEntry {
  action: string;
  label: string;
  /** The outcome the action records (the table has no outcome column). */
  outcome: AuditOutcome;
  /** True for the actions that change access, money, identity or destroy data. */
  sensitive: boolean;
  /** The entity the row points at. */
  entityType: string;
}

/**
 * Every action the application writes to `audit_logs`, in the order of the
 * admin sections. Verified against the write sites in `src/` (13 Nov 2026).
 */
export const AUDIT_ACTIONS: AuditActionEntry[] = [
  // ---------------------------------------------------------------- identity
  { action: "users.create", label: "إضافة مستخدم إدارة", outcome: "SUCCESS", sensitive: true, entityType: "users" },
  { action: "users.update", label: "تعديل بيانات مستخدم إدارة", outcome: "SUCCESS", sensitive: true, entityType: "users" },
  { action: "users.password", label: "تعيين/تغيير كلمة سر مستخدم", outcome: "SUCCESS", sensitive: true, entityType: "users" },
  { action: "users.role_assign", label: "إسناد دور لمستخدم", outcome: "SUCCESS", sensitive: true, entityType: "users" },
  { action: "users.role_remove", label: "إزالة دور من مستخدم", outcome: "SUCCESS", sensitive: true, entityType: "users" },
  { action: "roles.create", label: "إنشاء دور", outcome: "SUCCESS", sensitive: true, entityType: "roles" },
  { action: "roles.update", label: "تعديل دور", outcome: "SUCCESS", sensitive: true, entityType: "roles" },
  { action: "roles.delete", label: "حذف دور", outcome: "SUCCESS", sensitive: true, entityType: "roles" },
  { action: "roles.grant", label: "منح صلاحية لدور", outcome: "SUCCESS", sensitive: true, entityType: "roles" },
  { action: "roles.revoke", label: "سحب صلاحية من دور", outcome: "SUCCESS", sensitive: true, entityType: "roles" },
  { action: "settings.update", label: "تعديل إعداد من إعدادات المتجر", outcome: "SUCCESS", sensitive: true, entityType: "store_settings" },

  // -------------------------------------------------------------- delivery
  { action: "delivery_zones.create", label: "إضافة منطقة توصيل", outcome: "SUCCESS", sensitive: false, entityType: "delivery_zones" },
  { action: "delivery_zones.update", label: "تعديل منطقة توصيل", outcome: "SUCCESS", sensitive: true, entityType: "delivery_zones" },

  // -------------------------------------------------------------- catalogue
  { action: "categories.create", label: "إضافة تصنيف", outcome: "SUCCESS", sensitive: false, entityType: "categories" },
  { action: "categories.update", label: "تعديل تصنيف", outcome: "SUCCESS", sensitive: false, entityType: "categories" },
  { action: "brands.create", label: "إضافة علامة تجارية", outcome: "SUCCESS", sensitive: false, entityType: "brands" },
  { action: "brands.update", label: "تعديل علامة تجارية", outcome: "SUCCESS", sensitive: false, entityType: "brands" },
  { action: "products.create", label: "إضافة منتج", outcome: "SUCCESS", sensitive: false, entityType: "products" },
  { action: "products.update", label: "تعديل بيانات منتج", outcome: "SUCCESS", sensitive: false, entityType: "products" },
  { action: "products.archive", label: "أرشفة منتج", outcome: "SUCCESS", sensitive: true, entityType: "products" },
  { action: "products.restore", label: "استرجاع منتج مؤرشف", outcome: "SUCCESS", sensitive: true, entityType: "products" },
  { action: "products.hard_delete", label: "حذف نهائي لمنتج", outcome: "SUCCESS", sensitive: true, entityType: "products" },
  { action: "products.brand_associate", label: "ربط منتَج بعلامة تجارية بعد مراجعة", outcome: "SUCCESS", sensitive: false, entityType: "products" },
  { action: "products.brand_batch", label: "دفعة ربط منتجات بعلامة تجارية", outcome: "SUCCESS", sensitive: false, entityType: "brand_association_batches" },
  { action: "variants.create", label: "إضافة شكل بيع لمنتج", outcome: "SUCCESS", sensitive: false, entityType: "product_variants" },
  { action: "variants.update", label: "تعديل شكل بيع لمنتج", outcome: "SUCCESS", sensitive: false, entityType: "product_variants" },
  { action: "variants.price", label: "تعديل سعر شكل بيع", outcome: "SUCCESS", sensitive: true, entityType: "product_variants" },
  // CS-08 — website catalog sync actions (engine in src/lib/catalog-sync).
  { action: "products.sync", label: "مزامنة بيانات منتج من Studio", outcome: "SUCCESS", sensitive: true, entityType: "products" },
  { action: "product_variants.sync", label: "مزامنة متغيرات منتج من Studio", outcome: "SUCCESS", sensitive: false, entityType: "product_variants" },
  { action: "categories.sync", label: "مزامنة فئات من Studio", outcome: "SUCCESS", sensitive: false, entityType: "categories" },
  { action: "brands.sync", label: "مزامنة علامات تجارية من Studio", outcome: "SUCCESS", sensitive: false, entityType: "brands" },
  { action: "codes.create", label: "إضافة كود لمنتج", outcome: "SUCCESS", sensitive: false, entityType: "product_codes" },
  { action: "codes.update", label: "تعديل كود منتج", outcome: "SUCCESS", sensitive: false, entityType: "product_codes" },
  { action: "codes.delete", label: "حذف كود من منتج", outcome: "SUCCESS", sensitive: false, entityType: "product_codes" },
  { action: "images.register", label: "تسجيل صورة منتج", outcome: "SUCCESS", sensitive: false, entityType: "product_images" },
  { action: "images.primary", label: "تعيين صورة رئيسية", outcome: "SUCCESS", sensitive: false, entityType: "product_images" },
  { action: "images.update", label: "تعديل بيانات صورة", outcome: "SUCCESS", sensitive: false, entityType: "product_images" },
  { action: "images.delete", label: "حذف صورة منتج", outcome: "SUCCESS", sensitive: false, entityType: "product_images" },
  { action: "product_images.create", label: "نشر صورة منتج معلّقة للمراجعة", outcome: "SUCCESS", sensitive: false, entityType: "product_images" },

  // -------------------------------------------------------------- inventory
  { action: "inventory.create", label: "تهيئة مخزون منتج", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.adjust", label: "تسوية كمية مخزون", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.reserve", label: "حجز كمية لطلب", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.release", label: "تحرير كمية محجوزة", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.commit", label: "اعتماد حركة مخزون", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.threshold", label: "تعديل حد تنبيه المخزون", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.revert", label: "رجعة أرصدة استيراد مخزون", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.revert_row", label: "رجعة صف مرفوض من استيراد المخزون", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.import", label: "استيراد أرصدة مخزون من جدول", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "inventory.import_row", label: "صف استيراد مخزون مقبول", outcome: "SUCCESS", sensitive: false, entityType: "inventory" },
  { action: "pos.product_create", label: "إضافة منتج من استيراد POS", outcome: "SUCCESS", sensitive: false, entityType: "products" },

  // ----------------------------------------------------------------- orders
  { action: "orders.advance", label: "تقديم حالة الطلب", outcome: "SUCCESS", sensitive: false, entityType: "orders" },
  { action: "orders.pick", label: "تجهيز صنف / إرجاعه غير متاح", outcome: "SUCCESS", sensitive: false, entityType: "order_items" },
  { action: "orders.ready", label: "تجهيز الطلب بالكامل", outcome: "SUCCESS", sensitive: false, entityType: "orders" },
  { action: "orders.cancel", label: "إلغاء طلب", outcome: "SUCCESS", sensitive: true, entityType: "orders" },
  { action: "orders.credential_rotate", label: "تجديد بيانات اعتماد الطلب", outcome: "SUCCESS", sensitive: true, entityType: "orders" },
  { action: "orders.credential_revoke", label: "إلغاء بيانات اعتماد الطلب", outcome: "SUCCESS", sensitive: true, entityType: "orders" },

  // -------------------------------------------------------------- customers
  { action: "customers.register", label: "تسجيل عميل جديد", outcome: "SUCCESS", sensitive: false, entityType: "customers" },
  { action: "customers.update", label: "تعديل بيانات عميل", outcome: "SUCCESS", sensitive: false, entityType: "customers" },
  { action: "customers.anonymize", label: "إخفاء هوية عميل", outcome: "SUCCESS", sensitive: true, entityType: "customers" },
  { action: "customers.audit_redact", label: "تنقية القيم التاريخية لعميل مخفي الهوية", outcome: "SUCCESS", sensitive: true, entityType: "customers" },
  { action: "addresses.create", label: "إضافة عنوان لعميل", outcome: "SUCCESS", sensitive: false, entityType: "customer_addresses" },
  { action: "addresses.update", label: "تعديل عنوان عميل", outcome: "SUCCESS", sensitive: false, entityType: "customer_addresses" },
  { action: "addresses.delete", label: "حذف عنوان عميل", outcome: "SUCCESS", sensitive: false, entityType: "customer_addresses" },

  // ------------------------------------------------------------- promotions
  { action: "promotions.create", label: "إضافة عرض", outcome: "SUCCESS", sensitive: false, entityType: "promotions" },
  { action: "promotions.update", label: "تعديل عرض", outcome: "SUCCESS", sensitive: false, entityType: "promotions" },
  { action: "promotions.delete", label: "حذف عرض", outcome: "SUCCESS", sensitive: true, entityType: "promotions" },
  { action: "targets.create", label: "إضافة هدف للعرض", outcome: "SUCCESS", sensitive: false, entityType: "promotion_targets" },
  { action: "targets.delete", label: "حذف هدف من العرض", outcome: "SUCCESS", sensitive: false, entityType: "promotion_targets" },
  { action: "rules.update", label: "تعديل قواعد العرض", outcome: "SUCCESS", sensitive: false, entityType: "promotion_rules" },
  { action: "buyget.update", label: "تعديل قاعدة اشترِ واحصل", outcome: "SUCCESS", sensitive: false, entityType: "promotion_buy_get_rules" },
  { action: "coupons.create", label: "إضافة كود خصم", outcome: "SUCCESS", sensitive: false, entityType: "coupons" },
  { action: "coupons.update", label: "تعديل كود خصم", outcome: "SUCCESS", sensitive: false, entityType: "coupons" },
  { action: "coupons.delete", label: "حذف كود خصم", outcome: "SUCCESS", sensitive: true, entityType: "coupons" },

  // ----------------------------------------------------------- replacements
  { action: "replacements.propose", label: "اقتراح بديل لعميل", outcome: "SUCCESS", sensitive: false, entityType: "order_item_replacements" },
  { action: "replacements.withdraw", label: "سحب اقتراح البديل", outcome: "SUCCESS", sensitive: false, entityType: "order_item_replacements" },
  { action: "replacements.auto_accept", label: "قبول البديل من غير رد العميل", outcome: "SUCCESS", sensitive: false, entityType: "order_item_replacements" },

  // ------------------------------------------------------------------- auth
  { action: "auth.login_success", label: "تسجيل دخول ناجح", outcome: "SUCCESS", sensitive: false, entityType: "users" },
  { action: "auth.login_failure", label: "محاولة دخول فاشلة", outcome: "FAILURE", sensitive: true, entityType: "users" },
  { action: "auth.account_locked", label: "قفل حساب بعد محاولات فاشلة", outcome: "FAILURE", sensitive: true, entityType: "users" },
  { action: "auth.password_changed", label: "تغيير كلمة السر", outcome: "SUCCESS", sensitive: true, entityType: "users" },
  { action: "auth.logout", label: "تسجيل خروج", outcome: "SUCCESS", sensitive: false, entityType: "users" },
];

const ACTION_INDEX: Record<string, AuditActionEntry> = Object.fromEntries(
  AUDIT_ACTIONS.map((entry) => [entry.action, entry]),
);

/** The Arabic name of an action (an unknown action never shows a raw token). */
export function auditActionText(action: string): string {
  return ACTION_INDEX[action]?.label ?? "عمل غير معروف";
}

/** The outcome the action records. */
export function auditActionOutcome(action: string): AuditOutcome {
  return ACTION_INDEX[action]?.outcome ?? "SUCCESS";
}

/** True for the actions that change access, money, identity or destroy data. */
export function isSensitiveAuditAction(action: string): boolean {
  return ACTION_INDEX[action]?.sensitive === true;
}

/** The actions the filter may offer (the whole vocabulary). */
export const AUDIT_ACTION_KEYS: string[] = AUDIT_ACTIONS.map((entry) => entry.action);

/** The filter options, with their Arabic labels. */
export const AUDIT_ACTION_FILTER_OPTIONS = AUDIT_ACTIONS.map((entry) => ({
  value: entry.action,
  label: entry.label,
}));

/* --------------------------------------------------------------- policies */

/** Never stored (the write-time sanitiser drops these). */
export const AUDIT_FORBIDDEN_FIELDS = [
  "password",
  "passwordhash",
  "token",
  "tokenhash",
  "cookie",
  "authorization",
  "database_url",
  "api_key",
  "secret",
];

/** Stored, but hidden from a reader without the customer capability. */
export const AUDIT_MASKED_FIELDS = ["email", "phone", "firstname", "lastname"];

const MASKED_PATTERN = /^(email|phone|firstname|lastname|first_name|last_name|emailaddress|phone_number)$/i;

/** Mask a personal value without destroying its shape. */
export function maskAuditValue(value: string): string {
  if (value.length === 0) return value;
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    const head = local.slice(0, 1);
    return `${head}${"•".repeat(Math.max(1, local.length - 1))}@${domain}`;
  }
  if (/^\d[\d\s-]{5,}$/.test(value)) {
    const digits = value.replace(/\D/g, "");
    const head = digits.slice(0, 3);
    const tail = digits.slice(-2);
    return `${head}${"•".repeat(Math.max(1, digits.length - 5))}${tail}`;
  }
  return `${value.slice(0, 1)}${"•".repeat(Math.max(1, value.length - 1))}`;
}

/**
 * Apply the read-time field policy to an audit payload.
 *
 * `canSeePii` is the caller's capability to read customer contact data
 * (`customers.view`). Without it, the personal values are masked but still
 * present — the audit keeps its evidential value.
 */
export function maskAuditValues(values: unknown, canSeePii: boolean): unknown {
  if (Array.isArray(values)) return values.map((entry) => maskAuditValues(entry, canSeePii));
  if (values === null || typeof values !== "object") return values;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (AUDIT_FORBIDDEN_FIELDS.includes(key.toLowerCase())) {
      out[key] = "[محجوب]";
      continue;
    }
    if (!canSeePii && MASKED_PATTERN.test(key) && typeof value === "string") {
      out[key] = maskAuditValue(value);
      continue;
    }
    out[key] = maskAuditValues(value, canSeePii);
  }
  return out;
}
