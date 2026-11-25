// Delivery-fee resolver (single server-side authority).
//
// Precedence: an ACTIVE delivery zone matching the address key (area >
// village > city) overrides the base `delivery.default_fee` setting. No zone
// matches → base fee. A missing/invalid setting fails CLOSED (never a silent
// zero, never an invented 20); a corrupt zone row also fails closed instead of
// silently charging the base fee for a zone the admin explicitly priced.
//
// The resolver is the ONLY reader of the fee source. Estimate and order create
// both call it against the SAME database, so the preview and the committed
// order agree; a fee change between them is surfaced as a 409 via
// `expectedDeliveryFee` (never a silent total change).
//
// `delivery.enabled` is NOT read here (or anywhere in src/): it is a reserved
// delivery-phase key, not a service switch and not a fee gate. See
// docs/DELIVERY_FEE_CONTRACT (residual closure run).
import type { Prisma } from "@prisma/client";
import { formatPiastres, priceToPiastres } from "@/lib/cart/totals";
import {
  classifyDeliveryAddress,
  readDeliveryPricingSettings,
} from "@/lib/orders/delivery-pricing";
import {
  type DeliveryLocality,
  type DeliveryLocalityField,
} from "@/lib/orders/delivery-zone";
import {
  loadActiveDeliveryZones,
  type ActiveDeliveryZoneRow,
} from "@/lib/orders/delivery-zones-read";
import {
  findMatchingZone,
  resolveDeliveryEligibility,
  type DeliveryEligibility,
} from "@/lib/orders/delivery-eligibility";

/** Wire/DB shape for a NUMERIC(10,2) fee: non-negative, max 99,999,999.99. */
export const DELIVERY_FEE_TEXT_RE = /^\d{1,8}(\.\d{1,2})?$/;

export type DeliveryFeeSource = "DEFAULT" | "ZONE" | "CENTER" | "OUTSIDE_APPROVED";

export interface DeliveryFeeResolution {
  cents: number;
  fee: string;
  source: DeliveryFeeSource;
  zoneId: string | null;
  zoneName: string | null;
  matchedField: DeliveryLocalityField | null;
}

/**
 * The delivery quote: the fee AND the serviceability of the address, resolved
 * from ONE read of the zone rows so the two can never disagree (D-7).
 */
export interface DeliveryQuote {
  fee: DeliveryFeeResolution;
  eligibility: DeliveryEligibility;
}

type FeeDb = Pick<Prisma.TransactionClient, "$queryRaw">;

interface DefaultFeeRow {
  v: string;
}

function parseFeeText(raw: string | null | undefined): number {
  // Fail-closed server misconfiguration. The DB CHECK already forbids
  // negatives; this guard also rejects malformed text without inventing a fee.
  if (raw === null || raw === undefined || !DELIVERY_FEE_TEXT_RE.test(raw)) {
    throw new Error("Delivery fee misconfigured.");
  }
  return priceToPiastres(raw);
}

/**
 * Resolve the fee AND the eligibility for one address. `db` may be the Prisma
 * client (estimate) or an open transaction client (order create) — both read
 * the same rows.
 */
export async function resolveDeliveryQuote(
  db: FeeDb,
  address: DeliveryLocality | null | undefined,
): Promise<DeliveryQuote> {
  const defaultRows = await db.$queryRaw<DefaultFeeRow[]>`
    SELECT value_text AS v FROM store_settings WHERE key = 'delivery.default_fee'`;
  const rawDefault = defaultRows.length === 0 ? null : defaultRows[0].v;
  const defaultCents = parseFeeText(rawDefault);

  const zones: ActiveDeliveryZoneRow[] = await loadActiveDeliveryZones(db);
  const match = findMatchingZone(zones, address);

  // Owner-approved pricing (2026-11-19): inside Markaz Matay → EGP 20,
  // outside Markaz Matay within approved coverage → EGP 30. Runs only when
  // the store is configured for center pricing AND no legacy zone matched —
  // the zone path above keeps its own precedence so nothing changes until
  // the owner configures the center.
  const pricing = await readDeliveryPricingSettings(db);
  // Owner-approved pricing (2026-11-19): inside Markaz Matay → EGP 20,
  // outside Markaz Matay within approved coverage → EGP 30. Runs only when
  // the store is configured for center pricing AND no legacy zone matched —
  // the zone path keeps its own precedence so nothing changes until the
  // owner configures the center.
  if (!match && pricing.configured) {
    const cls = classifyDeliveryAddress(pricing, address);
    if (cls.kind === "MARKAZ") {
      return {
        fee: {
          cents: pricing.insideFeeCents,
          fee: formatPiastres(pricing.insideFeeCents),
          source: "CENTER",
          zoneId: null,
          zoneName: pricing.centerName,
          matchedField: null,
        },
        eligibility: {
          status: "MARKAZ_MATCHED",
          reason: `العنوان داخل ${pricing.centerName} — الرسوم المعتمدة.`,
          zoneId: null,
          zoneName: pricing.centerName,
          matchedField: null,
          serviceable: true,
          policy: "allow",
        },
      };
    }
    if (cls.kind === "OUTSIDE_APPROVED") {
      return {
        fee: {
          cents: pricing.outsideFeeCents,
          fee: formatPiastres(pricing.outsideFeeCents),
          source: "OUTSIDE_APPROVED",
          zoneId: null,
          zoneName: null,
          matchedField: null,
        },
        eligibility: {
          status: "SUPPORTED_OUTSIDE",
          reason: "عنوان موجود في مناطق التوصيل المعتمدة خارج المركز.",
          zoneId: null,
          zoneName: null,
          matchedField: null,
          serviceable: true,
          policy: "allow",
        },
      };
    }
    // UNSUPPORTED: configured center, no zone match, address outside every
    // approved list. Refuse service rather than silently treating it as
    // eligible with the default fee.
    return {
      fee: {
        cents: defaultCents,
        fee: formatPiastres(defaultCents),
        source: "DEFAULT",
        zoneId: null,
        zoneName: null,
        matchedField: null,
      },
      eligibility: {
        status: "UNSUPPORTED",
        reason: "عنوان غير موجود في منطقة التوصيل المعتمدة — لا يمكن الخدمة.",
        zoneId: null,
        zoneName: null,
        matchedField: null,
        serviceable: false,
        policy: "allow",
      },
    };
  }

  const eligibility = await resolveDeliveryEligibility(db, address, zones);

  if (match) {
    const cents = parseFeeText(match.zone.fee);
    return {
      fee: {
        cents,
        fee: formatPiastres(cents),
        source: "ZONE",
        zoneId: match.zone.id,
        zoneName: match.zone.name,
        matchedField: match.field,
      },
      eligibility,
    };
  }
  return {
    fee: {
      cents: defaultCents,
      fee: formatPiastres(defaultCents),
      source: "DEFAULT",
      zoneId: null,
      zoneName: null,
      matchedField: null,
    },
    eligibility,
  };
}

/**
 * Resolve the fee for one address. Kept as the narrow API for callers that
 * only need the amount; the fee is always computed by `resolveDeliveryQuote`.
 */
export async function resolveDeliveryFee(
  db: FeeDb,
  address: DeliveryLocality | null | undefined,
): Promise<DeliveryFeeResolution> {
  return (await resolveDeliveryQuote(db, address)).fee;
}
