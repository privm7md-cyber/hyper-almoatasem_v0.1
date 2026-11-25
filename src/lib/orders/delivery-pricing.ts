// Owner-approved delivery pricing (2026-11-19, owner decision update):
//
//   • Inside Markaz Matay (مطاي) → EGP 20 (delivery.inside_fee).
//   • Outside Markaz Matay within approved coverage → EGP 30 (delivery.outside_fee).
//   • Unknown / ambiguous / unsupported addresses → NOT serviceable.
//
// Pure classifier + settings reader. Composition (fee + eligibility) lives in
// delivery-fee.ts using this module. No customer-supplied flags are read:
// classification is purely from normalized address keys vs configured lists.
import type { Prisma } from "@prisma/client";
import { normalizeDeliveryLocality, type DeliveryLocality, deliveryLocalityKeys } from "@/lib/orders/delivery-zone";
import { priceToPiastres } from "@/lib/cart/totals";

export const DELIVERY_CENTER_NAME_KEY = "delivery.center_name";
export const DELIVERY_CENTER_VILLAGES_KEY = "delivery.center_villages";
export const DELIVERY_OUTSIDE_CITIES_KEY = "delivery.outside_cities";
export const DELIVERY_INSIDE_FEE_KEY = "delivery.inside_fee";
export const DELIVERY_OUTSIDE_FEE_KEY = "delivery.outside_fee";

export const DELIVERY_PRICING_KEYS: ReadonlySet<string> = new Set([
  DELIVERY_CENTER_NAME_KEY,
  DELIVERY_CENTER_VILLAGES_KEY,
  DELIVERY_OUTSIDE_CITIES_KEY,
  DELIVERY_INSIDE_FEE_KEY,
  DELIVERY_OUTSIDE_FEE_KEY,
]);

/** The center city of Markaz Matay — admin-configured (owner: "Markaz Matay"). */
export const DELIVERY_MARKAZ_NAME_DEFAULT = "مطاي";
/** Owner-approved fees. */
export const DELIVERY_INSIDE_FEE_DEFAULT = "20.00";
export const DELIVERY_OUTSIDE_FEE_DEFAULT = "30.00";

export interface DeliveryPricingSettings {
  /** Normalized city name of Markaz Matay, or null when unconfigured. */
  centerName: string | null;
  /** Normalized village/locality keys counted as inside the center. */
  centerVillages: string[];
  /** Normalized city names of approved outside-center coverage. */
  outsideCities: string[];
  insideFeeCents: number;
  outsideFeeCents: number;
  configured: boolean;
}

const FEE_RE = /^\d{1,8}(\.\d{2})?$/;

function parseFee(raw: string | null | undefined): number | null {
  if (!raw || !FEE_RE.test(raw)) return null;
  return priceToPiastres(raw);
}

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let values: string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    values = Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    // Read-only compatibility for any pre-registry comma-separated value.
    values = raw.split(",");
  }
  const out: string[] = [];
  for (const part of values) {
    const key = normalizeDeliveryLocality(part);
    if (key !== null && !out.includes(key)) out.push(key);
  }
  return out;
}

type SettingsDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function readDeliveryPricingSettings(db: SettingsDb): Promise<DeliveryPricingSettings> {
  const rows = await db.$queryRaw<Array<{ key: string; value_text: string | null }>>`
    SELECT key, value_text FROM store_settings
     WHERE key IN (${DELIVERY_CENTER_NAME_KEY}, ${DELIVERY_CENTER_VILLAGES_KEY}, ${DELIVERY_OUTSIDE_CITIES_KEY}, ${DELIVERY_INSIDE_FEE_KEY}, ${DELIVERY_OUTSIDE_FEE_KEY})`;
  const map = new Map(rows.map((r) => [r.key, r.value_text ?? null]));
  const centerName = normalizeDeliveryLocality(map.get(DELIVERY_CENTER_NAME_KEY));
  const insideFeeCents = parseFee(map.get(DELIVERY_INSIDE_FEE_KEY)) ?? priceToPiastres(DELIVERY_INSIDE_FEE_DEFAULT);
  const outsideFeeCents = parseFee(map.get(DELIVERY_OUTSIDE_FEE_KEY)) ?? priceToPiastres(DELIVERY_OUTSIDE_FEE_DEFAULT);
  return {
    centerName,
    centerVillages: splitList(map.get(DELIVERY_CENTER_VILLAGES_KEY)),
    outsideCities: splitList(map.get(DELIVERY_OUTSIDE_CITIES_KEY)),
    insideFeeCents,
    outsideFeeCents,
    configured: centerName !== null,
  };
}

export type DeliveryPricingKind = "MARKAZ" | "OUTSIDE_APPROVED" | "UNSUPPORTED";

export interface DeliveryPricingClassification {
  kind: DeliveryPricingKind;
  /** Normalized address keys considered (area > village > city order). */
  keys: string[];
}

/**
 * Classify one address against the configured center + approved outside
 * coverage. Legacy callers (no center configured) get UNSUPPORTED; the
 * caller then falls back to the pre-update zone/default-fee behavior.
 */
export function classifyDeliveryAddress(
  settings: DeliveryPricingSettings,
  address: DeliveryLocality | null | undefined,
): DeliveryPricingClassification {
  const keys = deliveryLocalityKeys(address).map((k) => k.key);
  if (settings.configured) {
    const insideKeys = new Set([settings.centerName as string, ...settings.centerVillages]);
    if (keys.some((k) => insideKeys.has(k))) {
      return { kind: "MARKAZ", keys };
    }
    if (keys.some((k) => settings.outsideCities.includes(k))) {
      return { kind: "OUTSIDE_APPROVED", keys };
    }
  }
  return { kind: "UNSUPPORTED", keys };
}
