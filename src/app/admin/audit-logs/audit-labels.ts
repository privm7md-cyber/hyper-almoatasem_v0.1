// Local Arabic labels for the audit trail.
//
// ADM-11: the vocabulary is now ONE list (`@/lib/admin/audit-vocabulary`) —
// it holds every action the store writes (68), with its label, its outcome
// and its sensitivity. The old local list covered only 61 actions and missed
// the product lifecycle, the image primary/update actions, the customer
// anonymization and the account lockout, so those rows were unfilterable and
// rendered as "عمل غير معروف".
//
// This module keeps the page's import surface and delegates to the vocabulary.

import { AUDIT_ENTITY_LABELS, auditEntityLabel } from "@/lib/admin/terminology";
import {
  AUDIT_ACTION_FILTER_OPTIONS,
  AUDIT_ACTION_KEYS,
  auditActionOutcome,
  auditActionText as vocabularyActionText,
  isSensitiveAuditAction,
} from "@/lib/admin/audit-vocabulary";

/** Kept for the shared import surface; the vocabulary holds the labels now. */
export const LOCAL_AUDIT_ACTION_LABELS: Record<string, string> = {};

/** The Arabic name of an action; an unknown action never shows its raw token. */
export function auditActionText(action: string): string {
  return vocabularyActionText(action);
}

/** The actions the store really writes — the filter may only offer these. */
export const REAL_AUDIT_ACTIONS: string[] = AUDIT_ACTION_KEYS;

/** The parts of the store an audit row can point at. */
export const REAL_AUDIT_ENTITIES: string[] = [
  "users",
  "roles",
  "store_settings",
  "delivery_zones",
  "products",
  "product_variants",
  "product_codes",
  "product_images",
  "categories",
  "brands",
  "inventory",
  "orders",
  "order_items",
  "order_item_replacements",
  "customers",
  "customer_addresses",
  "promotions",
  "promotion_targets",
  "promotion_rules",
  "promotion_buy_get_rules",
  "coupons",
];

/** The Arabic name of the part of the store a row points at. */
export function auditEntityText(entityType: string): string {
  return auditEntityLabel(entityType);
}

/** What a row means for the store — a committed change, or a refused attempt. */
export function auditResultText(action: string): string {
  if (auditActionOutcome(action) === "FAILURE") return "محاولة مرفوضة";
  if (action === "auth.login_success") return "دخول ناجح";
  if (action === "auth.logout") return "خرج من اللوحة";
  return "التغيير اتحفظ";
}

/** True for the sensitive actions (access, money, identity, destroy). */
export function auditIsSensitive(action: string): boolean {
  return isSensitiveAuditAction(action);
}

/** The entity labels the store really writes, for the filter options. */
export const AUDIT_ENTITY_FILTER_OPTIONS = REAL_AUDIT_ENTITIES.map((entity) => ({
  value: entity,
  label: AUDIT_ENTITY_LABELS[entity] ?? "نوع غير معروف",
}));

/** The action filter options (the complete vocabulary). */
export const AUDIT_ACTION_OPTIONS = AUDIT_ACTION_FILTER_OPTIONS;
