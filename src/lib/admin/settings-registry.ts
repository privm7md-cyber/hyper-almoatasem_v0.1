// ============================================================================
// SETTINGS REGISTRY — the catalogue of the store settings that really exist
// ============================================================================
// ADM-10: the settings screen used to render whatever rows happened to exist
// in `store_settings`, with no section, no type, no range and no explicit
// "editable" flag. This registry is the single source for:
//
//   • the Arabic name and the meaning of each key,
//   • the section it belongs to (the screen groups by it),
//   • its value type and the range the value may take,
//   • whether it may be edited at all (and by whom),
//   • what actually changes in the store when it changes.
//
// It contains ONLY the keys the project provisions. A row that exists in the
// database but not here is NOT editable through the API: the registry is the
// allow-list, so an out-of-band row cannot be changed from the admin.
//
// The "is this key read by the application?" column is honest: most seeded
// keys are configuration for the operating phase, and saying so is more
// useful than pretending the storefront already uses them.
// ============================================================================

export type SettingSectionKey =
  | "store"
  | "orders"
  | "pricing"
  | "inventory"
  | "accounts"
  | "notifications"
  | "display"
  | "security";

export interface SettingSection {
  key: SettingSectionKey;
  title: string;
  intro: string;
}

export const SETTING_SECTIONS: SettingSection[] = [
  {
    key: "store",
    title: "بيانات المتجر والفرع",
    intro: "الاسم وبيانات التواصل بتظهر لعميل المتجر.",
  },
  {
    key: "orders",
    title: "إعدادات الطلبات",
    intro: "قواعد استقبال الطلبات وإلغاءها تلقائيًا.",
  },
  {
    key: "pricing",
    title: "الأسعار والخصومات",
    intro: "رسوم التوصيل الافتراضية وقواعد التسعير المعتمدة.",
  },
  {
    key: "inventory",
    title: "المخزون والتنبيهات",
    intro: "حدود المخزون والتنبيهات المرتبطة بيه.",
  },
  {
    key: "accounts",
    title: "الحسابات والضيوف",
    intro: "إعدادات حسابات العملاء والطلبات بدون حساب.",
  },
  {
    key: "notifications",
    title: "الإشعارات",
    intro: "أنواع الإشعارات والقنوات المتاحة فعليًا.",
  },
  {
    key: "display",
    title: "عرض المنتجات",
    intro: "طريقة عرض المنتجات وحالة توفرها.",
  },
  {
    key: "security",
    title: "الأمان والجلسات",
    intro: "حدود الجلسات والحماية المفعّلة حاليًا.",
  },
];

export type SettingValueType = "TEXT" | "BOOLEAN" | "INTEGER" | "NUMERIC" | "JSON";

export interface SettingRegistryEntry {
  key: string;
  section: SettingSectionKey;
  label: string;
  /** What the setting means, in one Arabic sentence. */
  meaning: string;
  /** What actually changes in the store when the value changes. */
  effect: string;
  valueType: SettingValueType;
  /** True when the key may be changed from the admin screen. */
  editable: boolean;
  /** The allowed pattern/range (null = any value of the type). */
  pattern: RegExp | null;
  /** The Arabic explanation of the allowed range (null = no extra rule). */
  rangeNote: string | null;
  /** True when the value is a secret — never rendered, never echoed. */
  secret: boolean;
  /** True when the application reads this key today. */
  consumedByApp: boolean;
  /** Where the key is read (file:line) — null when it is not read yet. */
  consumedAt: string | null;
}

export const SETTING_REGISTRY: SettingRegistryEntry[] = [
  {
    key: "store.name",
    section: "store",
    label: "اسم المتجر",
    meaning: "الاسم العام للمتجر.",
    effect:
      "القيمة محفوظة في قاعدة البيانات، لكن واجهة المتجر بتعرض الهوية العربية المعتمدة من قرار المالك. نشر الاسم من الإعداد ده قرار مالك.",
    valueType: "TEXT",
    editable: false,
    pattern: /^[\s\S]{1,200}$/,
    rangeNote: "مجمّد لحد ما المالك يعتمد نشر الاسم.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "store.phone",
    section: "store",
    label: "تليفون التواصل",
    meaning: "الرقم اللي العملاء يتصلوا عليه.",
    effect:
      "المتجر بيعرض رقم التواصل المعتمد من وحدة التواصل في الكود (قرار المالك). القيمة دي محفوظة بس مش مصدر العرض، ونشر رقم من هنا قرار مالك.",
    valueType: "TEXT",
    editable: false,
    pattern: /^[\d+\s-]{6,20}$/,
    rangeNote: "مجمّد لحد ما المالك يعتمد مصدر العرض.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "store.email",
    section: "store",
    label: "بريد التواصل",
    meaning: "البريد اللي العملاء بيبعتوا عليه.",
    effect:
      "المتجر لا ينشر بريدًا (قرار المالك: قناة تليفون فقط). القيمة محفوظة بس مش بتظهر للعملاء.",
    valueType: "TEXT",
    editable: false,
    pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
    rangeNote: "مجمّد لحد ما المالك يقرّر قناة بريد.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "currency",
    section: "pricing",
    label: "العملة",
    meaning: "العملة الوحيدة اللي المتجر بيحاسب بيها.",
    effect: "القيمة محفوظة للعرض، لكن الكود بيستخدم EGP ثابت في المرحلة دي.",
    valueType: "TEXT",
    editable: false,
    pattern: null,
    rangeNote: "مجمّد على EGP في المرحلة دي.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "timezone",
    section: "store",
    label: "المنطقة الزمنية",
    meaning: "المنطقة الزمنية اللي كل التواريخ بتحسب بيها.",
    effect: "القيمة محفوظة للعرض، لكن حساب التواريخ بيستخدم إعداد المشروع الثابت حاليًا (Africa/Cairo).",
    valueType: "TEXT",
    editable: false,
    pattern: null,
    rangeNote: "مجمّد على Africa/Cairo في المرحلة دي.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "delivery.enabled",
    section: "orders",
    label: "تفعيل التوصيل",
    meaning: "مفتاح مرحلة التوصيل — مش مفتاح تشغيل الخدمة ومش بوابة رسوم.",
    effect:
      "مفيش استهلاك ليه في الكود: الرسوم والخدمة بيتحكموا في مناطق التوصيل النشطة، والقيمة دي محجوزة لمرحلة التوصيل.",
    valueType: "BOOLEAN",
    editable: false,
    pattern: null,
    rangeNote: "مفتاح محجوز لمرحلة التوصيل — مش قابل للتعديل من الشاشة.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "delivery.default_fee",
    section: "pricing",
    label: "رسوم التوصيل الافتراضية",
    meaning: "الرسوم اللي بتتحسب لما مفيش منطقة توصيل مطابقة للعنوان.",
    effect: "بتتحسب على الخادم وقت إنشاء الطلب، ومنطقة نشطة مطابقة بتتجاوزها.",
    valueType: "NUMERIC",
    editable: true,
    pattern: /^\d{1,8}(\.\d{1,2})?$/,
    rangeNote: "مبلغ موجب بخانتين عشريتين على الأكثر.",
    secret: false,
    consumedByApp: true,
    consumedAt: "src/lib/orders/delivery-fee.ts:85",
  },
  {
    key: "orders.auto_cancel_minutes",
    section: "orders",
    label: "مدة إلغاء الطلب غير المدفوع",
    meaning: "الوقت اللي الطلب غير المدفوع بيفضل معلّق فيه قبل ما يتلغى.",
    effect:
      "مفيش إلغاء تلقائي مفعّل في الكود: القيمة محفوظة كتحضير لمرحلة المدفوعات، وتفعيلها قرار مالك.",
    valueType: "INTEGER",
    editable: false,
    pattern: /^\d{1,5}$/,
    rangeNote: "مجمّد لحد ما يتعتمد الإلغاء التلقائي.",
    secret: false,
    consumedByApp: false,
    consumedAt: null,
  },
  {
    key: "delivery.center_name",
    section: "orders",
    label: "اسم مركز مطاي",
    meaning: "اسم مركز مطاي الذي تُصنّف عناوينه ضمن التوصيل الداخلي.",
    effect:
      "العناوين المطابقة للمركز أو لإحدى قراه تُحاسب برسوم التوصيل الداخلي المعتمدة.",
    valueType: "TEXT",
    editable: true,
    pattern: /^(?=.{1,80}$).*\S.*$/u,
    rangeNote: "اسم غير فارغ حتى 80 حرفًا (مثل مطاي).",
    secret: false,
    consumedByApp: true,
    consumedAt: "src/lib/orders/delivery-pricing.ts:14",
  },
  {
    key: "delivery.center_villages",
    section: "orders",
    label: "القرى داخل المركز",
    meaning: "قائمة القرى التي تتبع المركز المركزي — معاها بيتصنف داخليًا.",
    effect: "القرى اللي مكتوبة بيها (بحسب قواعد تطبيق delivery-pricing.ts) مع المدينة المركزية.",
    valueType: "JSON",
    editable: true,
    pattern: null,
    rangeNote: "مصفوفة نصية مطلوبة ([] مسموح).",
    secret: false,
    consumedByApp: true,
    consumedAt: "src/lib/orders/delivery-pricing.ts:15",
  },
  {
    key: "delivery.outside_cities",
    section: "orders",
    label: "المدن داخل منطقة التوصيل المعتمدة",
    meaning: "قائمة المدن خارج المركز المعتمدة عليها (غطاء التوصيل الخارجي المقرر).",
    effect: "عناوين في هذه المدن بتشحن بـ EGP 30 (منطقة التوصيل المعتمدة).",
    valueType: "JSON",
    editable: true,
    pattern: null,
    rangeNote: "مصفوفة نصية مطلوبة ([] مسموح).",
    secret: false,
    consumedByApp: true,
    consumedAt: "src/lib/orders/delivery-pricing.ts:16",
  },
  {
    key: "delivery.inside_fee",
    section: "orders",
    label: "رسوم التوصيل داخل المركز",
    meaning: "رسوم التوصيل داخل مركز مطاي (20 جنيهًا).",
    effect: "الطلب داخل المركز يُحاسب بها عند إنشاء الطلب على الخادم.",
    valueType: "NUMERIC",
    editable: true,
    pattern: /^\d{1,8}(\.\d{2})?$/,
    rangeNote: "مبلغ غير سالب بخانتين عشريتين على الأكثر.",
    secret: false,
    consumedByApp: true,
    consumedAt: "src/lib/orders/delivery-pricing.ts:17",
  },
  {
    key: "delivery.outside_fee",
    section: "orders",
    label: "رسوم التوصيل خارج المركز",
    meaning: "رسوم التوصيل خارج مركز مطاي داخل المناطق المعتمدة (30 جنيهًا).",
    effect: "الطلب في منطقة خارجية معتمدة يُحاسب بها عند إنشاء الطلب على الخادم.",
    valueType: "NUMERIC",
    editable: true,
    pattern: /^\d{1,8}(\.\d{2})?$/,
    rangeNote: "مبلغ غير سالب بخانتين عشريتين على الأكثر.",
    secret: false,
    consumedByApp: true,
    consumedAt: "src/lib/orders/delivery-pricing.ts:18",
  },
];

const REGISTRY_INDEX: Record<string, SettingRegistryEntry> = Object.fromEntries(
  SETTING_REGISTRY.map((entry) => [entry.key, entry]),
);

export function settingRegistryEntry(key: string): SettingRegistryEntry | null {
  return REGISTRY_INDEX[key] ?? null;
}

/** The keys that may be changed through the admin API. */
export function editableSettingKeys(): string[] {
  return SETTING_REGISTRY.filter((entry) => entry.editable).map((entry) => entry.key);
}

/** A key that looks like a secret is never rendered and never echoed. */
export function isSecretSettingKey(key: string): boolean {
  const entry = REGISTRY_INDEX[key];
  if (entry) return entry.secret;
  return /(secret|token|password|passwd|credential|api[_-]?key|private)/i.test(key);
}

/**
 * The registry's rule for one key: the pattern and the type it must satisfy.
 * `null` when the key is not in the registry (⇒ not editable at all).
 */
export function settingValueRule(key: string): { valueType: SettingValueType; pattern: RegExp | null } | null {
  const entry = REGISTRY_INDEX[key];
  if (!entry || !entry.editable) return null;
  return { valueType: entry.valueType, pattern: entry.pattern };
}
