// Delivery eligibility (D-7) — SEPARATE from the fee calculation.
//
// The previous review found a real operational hole: the store computes a
// delivery FEE correctly, but nothing ever says whether an address is
// SERVICEABLE. With zero active zones every address was charged the default
// fee and accepted, so "outside the delivery area" did not exist as a state.
//
// This module introduces that state without changing today's behaviour:
//
//   ZONE_MATCHED  — an ACTIVE zone matched the address (area > village > city).
//   UNCONFIGURED  — the store has NO active zone at all: there is no coverage
//                   configuration to judge against, so the default fee applies
//                   (exactly what happens today) and the address is served.
//   UNMATCHED     — zones exist but none matches this address: the address is
//                   OUTSIDE the configured areas. Today it is still served with
//                   the default fee; whether it may be served at all is an
//                   owner decision (D-7), so the policy is an explicit switch:
//
//     DELIVERY_ELIGIBILITY_POLICY=allow  (default — today's behaviour)
//     DELIVERY_ELIGIBILITY_POLICY=reject (the approved "outside the area is
//                                            refused" policy)
//
// The switch NEVER invents commercial data: it only decides what happens to
// an address that already failed to match a configured zone. It also never
// refuses an address while the store has no zones configured (UNCONFIGURED),
// because there is no policy to apply yet.
//
// The eligibility is computed by the SAME call that computes the fee, so the
// storefront preview and the committed order can never disagree.

import {
  deliveryLocalityKeys,
  type DeliveryLocality,
  type DeliveryLocalityField,
} from "@/lib/orders/delivery-zone";
import {
  loadActiveDeliveryZones,
  type ActiveDeliveryZoneRow,
  type ZoneDb,
} from "@/lib/orders/delivery-zones-read";
import { deliveryScopeKey } from "@/lib/orders/delivery-scope";

export type DeliveryEligibilityStatus =
  | "ZONE_MATCHED"
  | "UNCONFIGURED"
  | "UNMATCHED"
  | "MARKAZ_MATCHED"
  | "SUPPORTED_OUTSIDE"
  | "UNSUPPORTED";

export type DeliveryEligibilityPolicy = "allow" | "reject";

export interface DeliveryEligibility {
  /** The explicit serviceability state of the address. */
  status: DeliveryEligibilityStatus;
  /** Arabic, customer-facing explanation of the state. */
  reason: string;
  /** The matched zone, when there is one. */
  zoneId: string | null;
  zoneName: string | null;
  /** Which address field matched the zone (area > village > city). */
  matchedField: DeliveryLocalityField | null;
  /** True when the current policy serves this address. */
  serviceable: boolean;
  /** The policy that produced `serviceable`. */
  policy: DeliveryEligibilityPolicy;
}

/** The owner's policy switch. Default: today's behaviour (serve + default fee). */
export function deliveryEligibilityPolicy(): DeliveryEligibilityPolicy {
  return process.env.DELIVERY_ELIGIBILITY_POLICY === "reject" ? "reject" : "allow";
}

export interface ZoneMatch {
  zone: ActiveDeliveryZoneRow;
  field: DeliveryLocalityField;
}

/** The single matching rule: area > village > city, exact normalized match. */
export function findMatchingZone(
  zones: ActiveDeliveryZoneRow[],
  address: DeliveryLocality | null | undefined,
): ZoneMatch | null {
  const byKey = new Map(zones.map((zone) => [zone.normalized_name, zone]));
  // A configured city is mandatory for scoped zones. Same-named villages in
  // different centers never match each other. Explicit denials beat fallback.
  if(address?.city) for(const {field,key} of deliveryLocalityKeys(address)) {
    let scopedKey:string;
    try{scopedKey=deliveryScopeKey(address.city,key,field);}catch{continue;}
    const zone=byKey.get(scopedKey);
    if(zone) return {zone,field};
  }
  for (const { field, key } of deliveryLocalityKeys(address)) {
    const zone = byKey.get(key);
    if (zone) return { zone, field };
  }
  return null;
}

/**
 * The eligibility of one address. `zones` may be passed in when the caller
 * already loaded them (the quote path) so the rows are read once.
 */
export async function resolveDeliveryEligibility(
  db: ZoneDb,
  address: DeliveryLocality | null | undefined,
  zones?: ActiveDeliveryZoneRow[],
): Promise<DeliveryEligibility> {
  const rows = zones ?? (await loadActiveDeliveryZones(db));
  const policy = rows.some(row=>row.scope) ? "reject" : deliveryEligibilityPolicy();
  const match = findMatchingZone(rows, address);
  if (match) {
    return {
      status: "ZONE_MATCHED",
      reason: match.zone.scope && (!match.zone.scope.eligible || match.zone.is_active===false)
        ? `التوصيل غير متاح حاليًا لهذه المنطقة (${match.zone.name}).` : `العنوان داخل منطقة توصيل مفعّلة (${match.zone.name}).`,
      zoneId: match.zone.id,
      zoneName: match.zone.name,
      matchedField: match.field,
      serviceable: match.zone.scope ? match.zone.scope.eligible && match.zone.is_active!==false : true,
      policy,
    };
  }
  if (rows.length === 0) {
    return {
      status: "UNCONFIGURED",
      reason: "مفيش مناطق توصيل مفعّلة حاليًا — كل العناوين بتتحسب بالرسوم الافتراضية.",
      zoneId: null,
      zoneName: null,
      matchedField: null,
      serviceable: true,
      policy,
    };
  }
  return {
    status: "UNMATCHED",
    reason:
      policy === "reject"
        ? "العنوان خارج مناطق التوصيل المفعّلة، والمتجر مش بيخدمه."
        : "العنوان خارج مناطق التوصيل المفعّلة — الرسوم الافتراضية هتتحسب.",
    zoneId: null,
    zoneName: null,
    matchedField: null,
    serviceable: policy !== "reject",
    policy,
  };
}
