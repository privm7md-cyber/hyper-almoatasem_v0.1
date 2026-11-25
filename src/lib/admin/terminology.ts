// ADMIN TERMINOLOGY — the single Arabic dictionary for the admin panel.
//
// One rule governs this module: the operator never reads a machine token.
// Every enum, status, permission key, unit and setting name that can reach
// the screen is translated here into natural Egyptian Arabic, and every
// lookup falls back to a neutral Arabic phrase ("غير معروف") instead of
// echoing the raw value.
//
// Register: the admin speaks to a colleague about the store, so the copy is
// third person and operational ("الطلب اتأكد", "الكمية قاربت على الانتهاء") —
// never the second-person customer voice used by the storefront.
//
// This module is pure and server-safe: no DB, no server-only, no clock.

/* ------------------------------------------------------------------ enums */

/** How a product is sold. */
export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  PIECE: "بالقطعة",
  WEIGHT: "بالوزن",
};

/** Unit of sale / measurement. */
export const UNIT_LABELS: Record<string, string> = {
  PIECE: "قطعة",
  KG: "كجم",
  GRAM: "جم",
  LITER: "لتر",
  ML: "مل",
};

/** Size unit of a sellable shape (variant). */
export const SIZE_UNIT_LABELS: Record<string, string> = {
  PIECE: "قطعة",
  KG: "كجم",
  GRAM: "جم",
  LITER: "لتر",
  ML: "مل",
};

/** Barcode vs internal code. */
export const CODE_TYPE_LABELS: Record<string, string> = {
  BARCODE: "باركود",
  INTERNAL_CODE: "كود داخلي",
};

/** Order status — the store's own view of the order's journey. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  NEW: "طلب جديد",
  CONFIRMED: "الطلب متأكد",
  PREPARING: "قيد التجهيز",
  READY_FOR_DELIVERY: "جاهز للتوصيل",
  OUT_FOR_DELIVERY: "في الطريق",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
};

/** One-line explanation of what the order status means for the operator. */
export const ORDER_STATUS_MEANING: Record<string, string> = {
  NEW: "الطلب وصل للتو، وماتأكدش بعده.",
  CONFIRMED: "تم تأكيد الطلب، ومستني التجهيز.",
  PREPARING: "الفريق بيجهّز الطلب دلوقتي.",
  READY_FOR_DELIVERY: "الطلب خلص تجهيزه وجاهز يروح.",
  OUT_FOR_DELIVERY: "الطلب خرج مع مندوب التوصيل.",
  DELIVERED: "الطلب اتسلم و خلص.",
  CANCELLED: "الطلب اتلغى.",
};

/** Status of a single line inside an order. */
export const ORDER_ITEM_STATUS_LABELS: Record<string, string> = {
  PENDING: "لسه متجهّزش",
  FULFILLED: "تم تجهيزه",
  PARTIALLY_FULFILLED: "تم تجهيز جزء منه",
  UNAVAILABLE: "غير متوفر",
  REPLACED: "اتستبدل بمنتج تاني",
  CANCELLED: "ملغي",
};

/** Status of a substitute proposal on an order line. */
export const REPLACEMENT_STATUS_LABELS: Record<string, string> = {
  PROPOSED: "مقترح وفي انتظار الرد",
  CUSTOMER_APPROVED: "العميل وافق",
  CUSTOMER_REJECTED: "العميل رفض",
  AUTO_ACCEPTED: "اتقبل من غير ما يرد العميل",
};

/** Who made a recorded decision. */
export const ACTOR_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "العميل",
  GUEST: "ضيف",
  STAFF: "فريق المتجر",
  SYSTEM: "النظام",
  ADMIN: "الإدارة",
};

/** Stock situation of a sellable shape. */
export const STOCK_STATUS_LABELS: Record<string, string> = {
  in_stock: "متوفر",
  low_stock: "الكمية قاربت على الانتهاء",
  out_of_stock: "خلص من المخزن",
};

/** Why the quantity changed. Only the manual types are operator-selectable. */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  STOCK_IN: "إضافة كمية للمخزون",
  ADJUSTMENT: "تسوية كمية المخزون",
  WASTE: "تالف أو فاقد",
  RETURN: "رجوع كمية للمخزون",
  SALE: "بيع من المخزون",
  REPLACEMENT: "استبدال منتج",
  CANCELLED_ORDER: "إلغاء طلب",
};

/** The movement types the operator may pick by hand (the rest belong to orders). */
export const MANUAL_MOVEMENT_TYPES = ["STOCK_IN", "ADJUSTMENT", "WASTE", "RETURN"] as const;

/**
 * The free-text reason a movement carries. The store writes it in English
 * ("fulfillment pick", "Initial stock: …"), so the panel gives it an Arabic
 * reading — and keeps the original text next to it, because the note itself
 * may carry a name or a figure the operator needs.
 */
const MOVEMENT_REASON_LABELS: { match: RegExp; label: string }[] = [
  { match: /^fulfillment pick$/i, label: "تسليم كمية تجهيز طلب" },
  { match: /^initial stock\b/i, label: "الرصيد الافتتاحي" },
  { match: /^stock[- ]?in\b/i, label: "إضافة كمية للمخزون" },
  { match: /^manual adjustment\b/i, label: "تسوية يدوية للكمية" },
  { match: /^waste\b/i, label: "تالف أو فاقد" },
  { match: /^return\b/i, label: "رجوع كمية للمخزون" },
];

/** Any Latin letter in a free-text value. */
const LATIN_LETTER = /[A-Za-z]/;

/**
 * The Arabic reading of a movement reason, or null when the text is unknown.
 * A reason the operator wrote in Arabic is already its own reading and is
 * returned untouched — only the store's English tokens are translated.
 */
export function movementReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  const match = MOVEMENT_REASON_LABELS.find((entry) => entry.match.test(trimmed));
  if (match) return match.label;
  if (!LATIN_LETTER.test(trimmed)) return trimmed;
  return null;
}

/** Discount kinds the backend actually supports. */
export const PROMOTION_TYPE_LABELS: Record<string, string> = {
  PERCENTAGE: "خصم بنسبة مئوية",
  FIXED_AMOUNT: "خصم بمبلغ ثابت",
  FIXED_PRICE: "سعر ثابت للمنتج",
  BUY_X_GET_Y: "اشترِ كذا واحصل على كذا",
};

/** What the discount is calculated on — the "base" of the offer. */
export const PROMOTION_SCOPE_LABELS: Record<string, string> = {
  LINE: "على المنتجات المختارة بس",
  ORDER: "على إجمالي الطلب كله",
};

export const PROMOTION_SCOPE_MEANING: Record<string, string> = {
  LINE: "الخصم بيتحسب على المنتجات اللي اخترتها للعرض، مش على باقي الطلب.",
  ORDER: "الخصم بيتحسب على إجمالي الطلب كله.",
};

export const PROMOTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  ACTIVE: "شغّال",
  DISABLED: "موقوف",
};

/**
 * What the offer is DOING right now, which is not the same as the stored
 * status: an offer can be ACTIVE and still not be running (it starts later,
 * or it ended yesterday). The backend decides effectiveness with SQL
 * (`start_at <= now()` and `end_at > now()`); this mirrors that rule so the
 * panel never calls a finished offer "شغّال".
 */
export const PROMOTION_EFFECTIVE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  SCHEDULED: "مجدول",
  LIVE: "شغّال دلوقتي",
  EXPIRED: "منتهي",
  DISABLED: "موقوف",
};

export type PromotionEffectiveStatus = "DRAFT" | "SCHEDULED" | "LIVE" | "EXPIRED" | "DISABLED";

/** Which kind of thing an offer is attached to. */
export const PROMOTION_TARGET_LABELS: Record<string, string> = {
  VARIANT: "شكل بيع محدد",
  PRODUCT: "منتج",
  BRAND: "علامة تجارية",
  CATEGORY: "تصنيف",
};

/* ----------------------------------------------------------- permissions */

/**
 * Every permission key the system knows, phrased as something a staff member
 * can picture themselves doing. Grouped by the area of the store it belongs
 * to, because the catalogue page groups the same way.
 *
 * ADM-09: each entry also carries
 *   • `description` — one Arabic sentence saying what the key actually allows;
 *   • `capability` — the kind of action it authorizes (view / create / update /
 *     delete / approve / export / manage);
 *   • `sensitive` — true for the capabilities that need extra care. A
 *     sensitive key is NEVER shown as "active" just because it exists in the
 *     catalogue: it must exist in the database AND be granted to the account.
 */
export type PermissionCapability =
  | "view"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "export"
  | "manage";

export const PERMISSION_CAPABILITIES: { key: PermissionCapability; label: string; intro: string }[] = [
  { key: "view", label: "عرض", intro: "مشاهدة البيانات بدون تغييرها." },
  { key: "create", label: "إضافة", intro: "إنشاء سجل جديد." },
  { key: "update", label: "تعديل", intro: "تغيير بيانات موجودة." },
  { key: "delete", label: "حذف", intro: "حذف نهائي لا يمكن التراجع عنه." },
  { key: "approve", label: "اعتماد", intro: "اعتماد إجراء حساس بيأثر على المتجر." },
  { key: "export", label: "تصدير", intro: "إخراج البيانات من النظام." },
  { key: "manage", label: "إدارة الصلاحيات", intro: "إدارة أدوار المستخدمين وصلاحياتهم." },
];

export interface PermissionEntry {
  key: string;
  label: string;
  description: string;
  capability: PermissionCapability;
  sensitive: boolean;
}

export interface PermissionGroup {
  title: string;
  intro: string;
  permissions: PermissionEntry[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: "إدارة المنتجات",
    intro: "الصلاحيات الخاصة بالكتالوج: عرض المنتجات، إضافتها، تعديل بياناتها، وأسعارها.",
    permissions: [
      {
        key: "products.view",
        label: "عرض المنتجات",
        description: "تشوف المنتجات وأشكالها وبياناتها العامة من غير ما تقدر تعدّل.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "products.create",
        label: "إضافة منتج جديد",
        description: "تعمل منتج جديد وأشكاله وصوره وأكواده.",
        capability: "create",
        sensitive: false,
      },
      {
        key: "products.update",
        label: "تعديل بيانات المنتجات",
        description: "تعدّل وصف المنتجات وأشكالها وصورها وأكوادها — من غير ما تغيّر السعر.",
        capability: "update",
        sensitive: false,
      },
      {
        key: "products.delete",
        label: "حذف المنتجات",
        description:
          "حذف نهائي لمنتج ما لهوش أي تاريخ محمي (لا طلبات ولا حركات مخزون ولا سعر تاريخي). لو المنتج متّلزِم بالحذف بيترفض.",
        capability: "delete",
        sensitive: true,
      },
      {
        key: "prices.view",
        label: "عرض الأسعار",
        description: "تشوف سعر البيع وسعر المقارنة وتكلفة الشراء. التكلفة بتظهر للصلاحيات دي بس.",
        capability: "view",
        sensitive: true,
      },
      {
        key: "prices.update",
        label: "تعديل الأسعار",
        description: "تعدّل سعر البيع أو سعر المقارنة، وسعر الشراء لو كانت الصلاحية دي موجودة.",
        capability: "update",
        sensitive: true,
      },
    ],
  },
  {
    title: "إدارة المخزون",
    intro: "الصلاحيات الخاصة بالكميات: مراجعة الرصيد، إضافته، وتسوية الفروقات.",
    permissions: [
      {
        key: "inventory.view",
        label: "عرض المخزون",
        description: "تشوف أرصدة المنتجات وحركاتها ونتائج الجرد.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "inventory.adjust",
        label: "تعديل كميات المخزون",
        description: "تعدّل الكميات وتسوّي الفروقات وتسجّل التهيئة والالتزام.",
        capability: "update",
        sensitive: false,
      },
    ],
  },
  {
    title: "إدارة الطلبات",
    intro: "الصلاحيات الخاصة بالطلبات: مراجعتها، تجهيزها، وإلغاؤها.",
    permissions: [
      {
        key: "orders.view",
        label: "عرض الطلبات",
        description: "تشوف الطلبات وبيانات العميلSnapshot والتخصمات وحالة كل طلب.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "orders.update",
        label: "تحديث الطلبات وتجهيزها",
        description: "تبدأ التجهيز وتجهّز الأصناف وتسلّم الطلب وتتعامل مع الاستبدال.",
        capability: "update",
        sensitive: false,
      },
      {
        key: "orders.cancel",
        label: "إلغاء الطلبات",
        description: "إلغاء طلب قائم. الإلغاء بيعمل أثر في المخزون وسجل الطلبات.",
        capability: "approve",
        sensitive: true,
      },
    ],
  },
  {
    title: "إدارة العملاء",
    intro: "الصلاحيات الخاصة ببيانات العملاء وعناوينهم.",
    permissions: [
      {
        key: "customers.view",
        label: "عرض بيانات العملاء",
        description: "تشوف بيانات العميل وعناوينه وسجل طلباته.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "customers.manage",
        label: "تعديل بيانات العملاء",
        description: "تعدّل بيانات العميل وعناوينه. تعديل البيانات ما يعنيش إخفاء الهوية.",
        capability: "update",
        sensitive: false,
      },
      // A separate capability (owner decision, 12 Nov 2026): editing a
      // customer and hiding their identity for good are different levels of
      // severity. Holding `customers.manage` NEVER implies this one.
      {
        key: "customers.anonymize",
        label: "إخفاء هوية العميل نهائيًا",
        description:
          "إخفاء هوية العميل بشكل شبه دائم: الاسم والتليفون والعنوان والنص الحر بتتشال أو بتستبدل، والطلبات والتاريخ المالي بيفضلوا زي ما هما. العملية دي مفيش فيها استرجاع، ومحتاجة موافقة المالك.",
        capability: "delete",
        sensitive: true,
      },
    ],
  },
  {
    title: "إدارة العروض والخصومات",
    intro: "الصلاحيات الخاصة بالعروض وأكواد الخصم.",
    permissions: [
      {
        key: "promotions.view",
        label: "عرض العروض",
        description: "تشوف العروض وقواعدها ومعاينة سعرها على المنتجات.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "promotions.create",
        label: "إضافة عرض جديد",
        description: "تعمل عرض جديد بقواعده واستهدافاته.",
        capability: "create",
        sensitive: false,
      },
      {
        key: "promotions.update",
        label: "تعديل العروض",
        description: "تعدّل قواعد العرض واستهدافاته وتاريخه.",
        capability: "update",
        sensitive: false,
      },
      {
        key: "promotions.disable",
        label: "إيقاف وحذف العروض",
        description: "توقف عرض شغّال أو تحذفه نهائيًا. بيأثر على الطلبات الجاية.",
        capability: "approve",
        sensitive: true,
      },
      {
        key: "coupons.view",
        label: "عرض أكواد الخصم",
        description: "تشوف أكواد الخصم وحدودها وحالتها وسجل استخدامها.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "coupons.create",
        label: "إضافة كود خصم",
        description: "تعمل كود خصم مربوط بعرض موجود.",
        capability: "create",
        sensitive: false,
      },
      {
        key: "coupons.update",
        label: "تعديل أكواد الخصم",
        description: "تعدّل حدود الكود وحدود الاستخدام وتاريخه.",
        capability: "update",
        sensitive: false,
      },
      {
        key: "coupons.disable",
        label: "إيقاف وحذف أكواد الخصم",
        description: "توقف كود خصم أو تحذفه نهائيًا.",
        capability: "approve",
        sensitive: true,
      },
    ],
  },
  {
    title: "إدارة التوصيل",
    intro: "الصلاحيات الخاصة بمناطق التوصيل وتكلفتها.",
    permissions: [
      {
        key: "delivery.view",
        label: "عرض مناطق التوصيل",
        description: "تشوف مناطق التوصيل ورسومها وحالتها.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "delivery.assign",
        label: "توزيع الطلبات على مناطق التوصيل",
        description: "تحدّد منطقة التوصيل ورسومها للطلبات.",
        capability: "update",
        sensitive: false,
      },
    ],
  },
  {
    title: "إدارة الفريق والصلاحيات",
    intro: "الصلاحيات الخاصة بحسابات الفريق والأدوار وإعدادات المتجر وسجل التغييرات.",
    permissions: [
      {
        key: "users.view",
        label: "عرض مستخدمي الإدارة",
        description: "تشوف حسابات الإدارة وأدوارها.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "users.manage",
        label: "إضافة وتعديل مستخدمي الإدارة",
        description: "تعمل حسابات إدارة جديدة أو تعدّلها أو توقفها. الحسابات دي بتبقى able تتوصل لكل الصلاحيات الممنوحة.",
        capability: "update",
        sensitive: true,
      },
      {
        key: "roles.view",
        label: "عرض الأدوار",
        description: "تشوف الأدوار وصلاحياتها وأعضائها.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "roles.manage",
        label: "إضافة وتعديل الأدوار والصلاحيات",
        description:
          "تعمل أدوار جديدة وتعدّل صلاحياتها وتسند الأدوار للمستخدمين. من غير سقف: تقدر تمنح بس اللي إنت شايفه بس.",
        capability: "manage",
        sensitive: true,
      },
      {
        key: "settings.view",
        label: "عرض إعدادات المتجر",
        description: "تشوف إعدادات المتجر ومناطق التوصيل.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "settings.manage",
        label: "تعديل إعدادات المتجر",
        description: "تعدّل إعدادات المتجر ومناطق التوصيل ورسومها.",
        capability: "update",
        sensitive: true,
      },
      {
        key: "audit_logs.view",
        label: "عرض سجل التغييرات",
        description: "تشوف مين عمل إيه وإمتى. البيانات الشخصية في السجل بتظهر مخفية إلا للصلاحية المناسبة.",
        capability: "view",
        sensitive: true,
      },
      {
        key: "reports.view",
        label: "عرض التقارير",
        description: "تشوف التقارير والتحليلات.",
        capability: "view",
        sensitive: false,
      },
      {
        key: "notifications.view",
        label: "عرض الإشعارات",
        description: "تشوف صندوق الإشعارات الخاص بحسابك.",
        capability: "view",
        sensitive: false,
      },
    ],
  },
];

const PERMISSION_INDEX: Record<string, PermissionEntry> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => [p.key, p])),
);

const PERMISSION_LABEL_INDEX: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => [p.key, p.label])),
);

export function permissionLabel(key: string): string {
  return PERMISSION_LABEL_INDEX[key] ?? "صلاحية غير معروفة";
}

/** What the key allows, in one Arabic sentence. */
export function permissionDescription(key: string): string {
  return PERMISSION_INDEX[key]?.description ?? "صلاحية غير معروفة.";
}

/** The kind of action the key authorizes. */
export function permissionCapability(key: string): PermissionCapability | null {
  return PERMISSION_INDEX[key]?.capability ?? null;
}

/** True for the capabilities that need extra care (delete, prices, RBAC…). */
export function isSensitivePermission(key: string): boolean {
  return PERMISSION_INDEX[key]?.sensitive === true;
}

/** The Arabic label of a capability type. */
export function permissionCapabilityLabel(capability: PermissionCapability): string {
  return PERMISSION_CAPABILITIES.find((c) => c.key === capability)?.label ?? capability;
}

/** The group a permission belongs to (for the grouped catalogue). */
export function permissionGroupOf(key: string): PermissionGroup | null {
  return PERMISSION_GROUPS.find((group) => group.permissions.some((p) => p.key === key)) ?? null;
}

/** Shown when the signed-in account does not hold a permission. */
export function forbiddenSentence(key: string): string {
  return `الحساب ده مش مسموح له يعمل الخطوة دي. الصلاحية المطلوبة: ${permissionLabel(key)}.`;
}

/* ----------------------------------------------------------------- roles */

/** Any Arabic letter. */
const ARABIC_TEXT = /[\u0600-\u06FF]/;

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "مالك المتجر",
  STORE_ADMIN: "مدير المتجر",
};

/**
 * The name the operator reads for a role.
 *
 * The two store roles have a fixed Arabic name. A role the owner created is
 * named in Arabic by hand and is shown as it is. A role whose stored name is
 * a machine word is not something the operator reads, so it is called what it
 * really is — a role added by hand — instead of printing the machine word.
 */
export function roleLabel(name: string): string {
  const known = ROLE_LABELS[name];
  if (known) return known;
  return ARABIC_TEXT.test(name) ? name : "دور مخصص";
}

/* ------------------------------------------------------------- the person */

/** Whether a written name is in Arabic. */
export function hasArabicText(value: string | null | undefined): boolean {
  return ARABIC_TEXT.test((value ?? "").trim());
}

/** Actual account name in any language; roles are a fallback only if absent. */
export function operatorDisplayName(
  name: string | null | undefined,
  roles: string[],
): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) return trimmed;
  const known = roles.find((role) => ROLE_LABELS[role]);
  return known ? ROLE_LABELS[known] : "مستخدم المتجر";
}

/* -------------------------------------------------------------- settings */

export const SETTING_LABELS: Record<string, string> = {
  "store.name": "اسم المتجر",
  "store.phone": "تليفون المتجر",
  "store.email": "بريد المتجر",
  currency: "عملة الأسعار",
  timezone: "المنطقة الزمنية",
  "delivery.enabled": "تشغيل التوصيل",
  "delivery.default_fee": "رسوم التوصيل الافتراضية",
  "orders.auto_cancel_minutes": "دقائق الإلغاء التلقائي",
};

export const SETTING_MEANING: Record<string, string> = {
  "store.name": "الاسم العام للمتجر — محفوظ في الإعدادات، وواجهة المتجر بتعرض الهوية المعتمدة.",
  "store.phone": "تليفون التواصل — المتجر بيعرض الرقم المعتمد من وحدة التواصل في الكود.",
  "store.email": "بريد المتجر — مش بيظهر للعميل (قرار المالك: قناة تليفون فقط).",
  currency: "العملة اللي بتعرض بيها كل الأسعار في اللوحة.",
  timezone: "المنطقة الزمنية المستخدمة في تواريخ الطلبات.",
  "delivery.enabled": "مفتاح محجوز لمرحلة التوصيل — مش مفتاح تشغيل الخدمة؛ الرسوم بتتحسب من مناطق التوصيل النشطة.",
  "delivery.default_fee": "رسوم التوصيل اللي بتتحسب للطلب لو مفيش منطقة محددة.",
  "orders.auto_cancel_minutes": "القيمة محفوظة كتحضير، ومفيش إلغاء تلقائي مفعّل في الكود دلوقتي.",
};

export const SETTING_VALUE_TYPE_LABELS: Record<string, string> = {
  TEXT: "نص",
  BOOLEAN: "مفعّل أو موقوف",
  INTEGER: "رقم صحيح",
  NUMERIC: "مبلغ أو نسبة",
  JSON: "بيانات",
};

export function settingLabel(key: string): string {
  return SETTING_LABELS[key] ?? "إعداد بدون اسم معروف";
}

export function settingValueTypeLabel(type: string): string {
  return SETTING_VALUE_TYPE_LABELS[type] ?? "نوع غير معروف";
}

/* ----------------------------------------------------------- audit trail */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "users.create": "إضافة مستخدم إدارة",
  "users.update": "تعديل بيانات مستخدم",
  "users.password": "تغيير كلمة مرور مستخدم",
  "users.role_assign": "منح دور لمستخدم",
  "users.role_remove": "سحب دور من مستخدم",
  "roles.create": "إضافة دور جديد",
  "roles.update": "تعديل دور",
  "roles.delete": "حذف دور",
  "roles.grant": "منح صلاحية لدور",
  "roles.revoke": "سحب صلاحية من دور",
  "settings.update": "تعديل إعداد من إعدادات المتجر",
  "delivery_zones.create": "إضافة منطقة توصيل",
  "delivery_zones.update": "تعديل منطقة توصيل",
  "products.create": "إضافة منتج",
  "products.update": "تعديل منتج",
  "products.delete": "حذف منتج",
  "inventory.adjust": "تسوية كمية في المخزون",
  "inventory.threshold": "تعديل حد التنبيه للمخزون",
  "inventory.create": "تسجيل كمية مخزون",
  "inventory.reserve": "حجز كمية من المخزون",
  "inventory.release": "تحرير كمية محجوزة",
  "inventory.commit": "خصم كمية من المخزون",
  "orders.advance": "تغيير حالة طلب",
  "orders.cancel": "إلغاء طلب",
  "orders.pick": "تسجيل كمية تم تجهيزها",
  "orders.ready": "إنهاء تجهيز الطلب",
  "orders.credential_rotate": "تجديد رمز وصول الطلب",
  "orders.credential_revoke": "إلغاء رمز وصول الطلب",
  "customers.update": "تعديل بيانات عميل",
  "customers.register": "تسجيل عميل بحساب",
  "promotions.create": "إضافة عرض",
  "promotions.update": "تعديل عرض",
  "promotions.disable": "إيقاف عرض",
  "promotions.delete": "حذف عرض",
  "coupons.create": "إضافة كود خصم",
  "coupons.update": "تعديل كود خصم",
  "coupons.disable": "إيقاف كود خصم",
  "coupons.delete": "حذف كود خصم",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  users: "مستخدمو الإدارة",
  roles: "الأدوار",
  store_settings: "إعدادات المتجر",
  delivery_zones: "مناطق التوصيل",
  products: "المنتجات",
  product_variants: "أشكال بيع المنتجات",
  product_codes: "باركود المنتجات",
  product_images: "صور المنتجات",
  categories: "التصنيفات",
  brands: "العلامات التجارية",
  inventory: "المخزون",
  orders: "الطلبات",
  order: "الطلبات",
  order_items: "عناصر الطلبات",
  order_item_replacements: "البدائل",
  customers: "العملاء",
  customer_addresses: "عناوين العملاء",
  promotions: "العروض",
  promotion_targets: "استهدافات العروض",
  promotion_rules: "قواعد العروض",
  promotion_buy_get_rules: "قواعد اشترِ واحصل",
  coupons: "أكواد الخصم",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? "عمل غير معروف";
}

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? "نوع غير معروف";
}

/* ------------------------------------------------------------- name trust */

export const NAME_TRUST_LABELS: Record<string, string> = {
  "needs-review": "الاسم محتاج مراجعة",
  "test-data": "بيانات اختبار",
};

/* ---------------------------------------------------------- lookup helper */

/**
 * The one lookup every screen uses. A known token becomes its Arabic label; an
 * unknown token becomes a neutral Arabic phrase — never the raw value.
 */
export function labelFor(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "غير معروف";
  return map[value] ?? "غير معروف";
}

export function orderStatusLabel(status: string): string {
  return labelFor(ORDER_STATUS_LABELS, status);
}

export function orderStatusMeaning(status: string): string {
  return ORDER_STATUS_MEANING[status] ?? "الحالة دي مش معروفة.";
}

export function itemStatusLabel(status: string): string {
  return labelFor(ORDER_ITEM_STATUS_LABELS, status);
}

export function replacementStatusLabel(status: string): string {
  return labelFor(REPLACEMENT_STATUS_LABELS, status);
}

export function actorTypeLabel(type: string): string {
  return labelFor(ACTOR_TYPE_LABELS, type);
}

export function stockStatusLabel(status: string): string {
  return labelFor(STOCK_STATUS_LABELS, status);
}

export function movementTypeLabel(type: string): string {
  return labelFor(MOVEMENT_TYPE_LABELS, type);
}

export function productTypeLabel(type: string): string {
  return labelFor(PRODUCT_TYPE_LABELS, type);
}

export function unitLabel(unit: string): string {
  return labelFor(UNIT_LABELS, unit);
}

export function sizeUnitLabel(unit: string): string {
  return labelFor(SIZE_UNIT_LABELS, unit);
}

export function codeTypeLabel(type: string): string {
  return labelFor(CODE_TYPE_LABELS, type);
}

export function promotionTypeLabel(type: string): string {
  return labelFor(PROMOTION_TYPE_LABELS, type);
}

export function promotionScopeLabel(scope: string): string {
  return labelFor(PROMOTION_SCOPE_LABELS, scope);
}

export function promotionScopeMeaning(scope: string): string {
  return PROMOTION_SCOPE_MEANING[scope] ?? "";
}

export function promotionStatusLabel(status: string): string {
  return labelFor(PROMOTION_STATUS_LABELS, status);
}

/**
 * The effective state of an offer at a given instant. The clock is passed in
 * (this module stays pure); the rule is the backend's own: an offer runs only
 * when it is ACTIVE, it has started, and it has not ended yet.
 */
export function promotionEffectiveStatus(
  status: string,
  startAt: string | Date | null | undefined,
  endAt: string | Date | null | undefined,
  now: Date,
): PromotionEffectiveStatus {
  if (status === "DRAFT") return "DRAFT";
  if (status === "DISABLED") return "DISABLED";
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (start && !Number.isNaN(start.getTime()) && start.getTime() > now.getTime()) return "SCHEDULED";
  if (end && !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime()) return "EXPIRED";
  return "LIVE";
}

/** The Arabic name of the effective state (never the stored token). */
export function promotionEffectiveStatusLabel(
  status: string,
  startAt: string | Date | null | undefined,
  endAt: string | Date | null | undefined,
  now: Date,
): string {
  return PROMOTION_EFFECTIVE_STATUS_LABELS[promotionEffectiveStatus(status, startAt, endAt, now)] ?? "غير معروف";
}

export function promotionTargetLabel(type: string): string {
  return labelFor(PROMOTION_TARGET_LABELS, type);
}

/* ------------------------------------------------------------ formatting */

// Timestamps always use Cairo, independent of server/browser timezone. Exact
// YYYY-MM-DD values are calendar dates, not instants: format them in UTC and
// do not invent a time of day. English Gregorian names and Latin digits only.
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  calendar: "gregory",
  day: "2-digit",
  month: "short",
  year: "numeric",
};
const LONG_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  calendar: "gregory",
  day: "numeric",
  month: "long",
  year: "numeric",
};
const CAIRO_DATE = new Intl.DateTimeFormat("en-GB", { ...DATE_OPTIONS, timeZone: "Africa/Cairo" });
const CALENDAR_DATE = new Intl.DateTimeFormat("en-GB", { ...DATE_OPTIONS, timeZone: "UTC" });
const CAIRO_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  ...DATE_OPTIONS,
  timeZone: "Africa/Cairo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const CAIRO_DATE_LONG = new Intl.DateTimeFormat("en-GB", { ...LONG_DATE_OPTIONS, timeZone: "Africa/Cairo" });
const CALENDAR_DATE_LONG = new Intl.DateTimeFormat("en-GB", { ...LONG_DATE_OPTIONS, timeZone: "UTC" });

function adminDate(value: string | Date | null | undefined): { date: Date; calendarOnly: boolean } | null {
  if (!value) return null;
  const calendarOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = value instanceof Date ? value : new Date(calendarOnly ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;
  // JS normalises impossible days (e.g. 30 February), even in ISO timestamps.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
    const day = value.slice(0, 10);
    const calendar = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return null;
  }
  return { date, calendarOnly };
}

/** "12 Mar 2026". Calendar-only input keeps the exact supplied day. */
export function formatDate(iso: string | Date | null | undefined): string {
  const parsed = adminDate(iso);
  return parsed ? (parsed.calendarOnly ? CALENDAR_DATE : CAIRO_DATE).format(parsed.date) : "غير معروف";
}

/** "12 Mar 2026, 04:35" (Cairo); calendar-only input has no invented time. */
export function formatDateTime(iso: string | Date | null | undefined): string {
  const parsed = adminDate(iso);
  return parsed ? (parsed.calendarOnly ? CALENDAR_DATE : CAIRO_DATE_TIME).format(parsed.date) : "غير معروف";
}

export function formatDateLong(iso: string | Date | null | undefined): string {
  const parsed = adminDate(iso);
  return parsed ? (parsed.calendarOnly ? CALENDAR_DATE_LONG : CAIRO_DATE_LONG).format(parsed.date) : "غير معروف";
}

/** "من 3 أيام" / "الآن" — a relative age an operator can act on. */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "غير معروف";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "غير معروف";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "الآن";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `من ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `من ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `من ${days} يوم`;
  const months = Math.round(days / 30);
  if (months < 12) return `من ${months} شهر`;
  return `من ${Math.round(months / 12)} سنة`;
}

/** Money with the store's currency label. Amounts stay Latin digits. */
export function formatMoney(amount: string | number | null | undefined, currency = "ج.م"): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Quantities keep up to 3 decimals (the schema's precision) and drop noise. */
export function formatQuantity(quantity: string | number | null | undefined): string {
  if (quantity === null || quantity === undefined || quantity === "") return "—";
  const value = Number(quantity);
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
