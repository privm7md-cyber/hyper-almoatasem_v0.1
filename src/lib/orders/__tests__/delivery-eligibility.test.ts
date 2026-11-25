// @vitest-environment node
// Phase 19 / D-7: Delivery-zone eligibility & fee resolution verification suite.
// Covers:
//  1. UNCONFIGURED (0 active zones -> serviceable=true, default fee, under both allow and reject policies)
//  2. ZONE_MATCHED (area > village > city precedence, conflicting rules resolved deterministically, orthographic normalization)
//  3. UNMATCHED under DELIVERY_ELIGIBILITY_POLICY=allow (default: serviceable=true, fallback to default fee)
//  4. UNMATCHED under DELIVERY_ELIGIBILITY_POLICY=reject (owner opt-in: serviceable=false, createOrder rejects with BUSINESS_RULE)
//  5. DELIVERY_ELIGIBILITY_CHANGED (createOrder rejects with 409 CONFLICT when expectedDeliveryEligibility drifts from live quote)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadActiveDeliveryZones: vi.fn(),
  cartFindFirst: vi.fn(),
  transaction: vi.fn(),
  findOrderByIdempotencyKey: vi.fn(),
  findOrderByCart: vi.fn(),
  applyPromotions: vi.fn(),
  persistPromoRows: vi.fn(),
  auditInTx: vi.fn(),
}));

vi.mock("@/lib/orders/delivery-zones-read", () => ({
  loadActiveDeliveryZones: mocks.loadActiveDeliveryZones,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    cart: { findFirst: mocks.cartFindFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/orders/queries", () => ({
  findOrderByIdempotencyKey: mocks.findOrderByIdempotencyKey,
  findOrderByCart: mocks.findOrderByCart,
}));

vi.mock("@/lib/promotions/checkout", () => ({
  applyPromotions: mocks.applyPromotions,
  persistPromoRows: mocks.persistPromoRows,
}));

vi.mock("@/lib/api/audit", () => ({
  auditInTx: mocks.auditInTx,
}));

vi.mock("@/lib/orders/guest-access", () => ({
  issueGuestOrderCredential: vi.fn(),
}));

vi.mock("@/lib/orders/guest-checkout-session", () => ({
  bindGuestCheckoutSessionToOrder: vi.fn(),
}));

import { deliveryEligibilityPolicy, resolveDeliveryEligibility } from "../delivery-eligibility";
import { resolveDeliveryFee, resolveDeliveryQuote } from "../delivery-fee";
import { createOrder } from "../writes";

const ZONE_CITY_CAIRO = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "القاهرة",
  normalized_name: "القاهره",
  fee: "40.00",
};

const ZONE_VILLAGE_BASATEEN = {
  id: "00000000-0000-4000-8000-000000000102",
  name: "البساتين",
  normalized_name: "البساتين",
  fee: "30.00",
};

const ZONE_AREA_MAADI = {
  id: "00000000-0000-4000-8000-000000000103",
  name: "المعادي",
  normalized_name: "المعادي",
  fee: "15.00",
};

function makeFeeDb(defaultFee = "25.00") {
  return {
    $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM store_settings")) {
        return [{ v: defaultFee }];
      }
      return [];
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  mocks.loadActiveDeliveryZones.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deliveryEligibilityPolicy", () => {
  it("defaults to 'allow' when unset, blank, or unrecognized", () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "");
    expect(deliveryEligibilityPolicy()).toBe("allow");

    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "   ");
    expect(deliveryEligibilityPolicy()).toBe("allow");

    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "unknown-value");
    expect(deliveryEligibilityPolicy()).toBe("allow");
  });

  it("returns 'reject' when explicitly configured", () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "reject");
    expect(deliveryEligibilityPolicy()).toBe("reject");
  });
});

describe("resolveDeliveryQuote & resolveDeliveryEligibility — UNCONFIGURED, ZONE_MATCHED, UNMATCHED", () => {
  it("returns UNCONFIGURED (serviceable: true, default fee) when 0 active delivery zones exist, even under reject policy", async () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "reject");
    mocks.loadActiveDeliveryZones.mockResolvedValue([]);
    const db = makeFeeDb("25.00");

    const quote = await resolveDeliveryQuote(db as never, {
      city: "أسوان",
      area: "الكورنيش",
      village: null,
    });

    expect(quote.fee).toEqual({
      cents: 2500,
      fee: "25.00",
      source: "DEFAULT",
      zoneId: null,
      zoneName: null,
      matchedField: null,
    });
    expect(quote.eligibility.status).toBe("UNCONFIGURED");
    expect(quote.eligibility.serviceable).toBe(true);
    expect(quote.eligibility.policy).toBe("reject");
    expect(quote.eligibility.zoneId).toBeNull();
    expect(quote.eligibility.matchedField).toBeNull();
  });

  it("resolves conflicting rules deterministically via area > village > city priority", async () => {
    // All 3 localities match active zones with different fees (15, 30, 40);
    // area ("المعادى" -> normalized "المعادي") must win over village and city.
    mocks.loadActiveDeliveryZones.mockResolvedValue([
      ZONE_CITY_CAIRO,
      ZONE_VILLAGE_BASATEEN,
      ZONE_AREA_MAADI,
    ]);
    const db = makeFeeDb("25.00");

    const quoteAllThree = await resolveDeliveryQuote(db as never, {
      city: "القاهرة",
      village: "البساتين",
      area: "المعادى", // orthographic ى -> ي
    });

    expect(quoteAllThree.fee).toEqual({
      cents: 1500,
      fee: "15.00",
      source: "ZONE",
      zoneId: ZONE_AREA_MAADI.id,
      zoneName: "المعادي",
      matchedField: "area",
    });
    expect(quoteAllThree.eligibility.status).toBe("ZONE_MATCHED");
    expect(quoteAllThree.eligibility.serviceable).toBe(true);
    expect(quoteAllThree.eligibility.matchedField).toBe("area");
    expect(quoteAllThree.eligibility.zoneId).toBe(ZONE_AREA_MAADI.id);

    // When area does not match any active zone, village wins over city.
    mocks.loadActiveDeliveryZones.mockResolvedValue([
      ZONE_CITY_CAIRO,
      ZONE_VILLAGE_BASATEEN,
    ]);

    const quoteVillageOverCity = await resolveDeliveryQuote(db as never, {
      city: "القاهرة",
      village: "البساتين",
      area: "حي غير مسجل",
    });

    expect(quoteVillageOverCity.fee).toEqual({
      cents: 3000,
      fee: "30.00",
      source: "ZONE",
      zoneId: ZONE_VILLAGE_BASATEEN.id,
      zoneName: "البساتين",
      matchedField: "village",
    });
    expect(quoteVillageOverCity.eligibility.status).toBe("ZONE_MATCHED");
    expect(quoteVillageOverCity.eligibility.matchedField).toBe("village");
  });

  it("returns UNMATCHED with serviceable=true and default fee under default 'allow' policy", async () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "allow");
    mocks.loadActiveDeliveryZones.mockResolvedValue([ZONE_CITY_CAIRO]);
    const db = makeFeeDb("25.00");

    const quote = await resolveDeliveryQuote(db as never, {
      city: "مطروح",
      area: null,
      village: null,
    });

    expect(quote.fee.fee).toBe("25.00");
    expect(quote.fee.source).toBe("DEFAULT");
    expect(quote.eligibility.status).toBe("UNMATCHED");
    expect(quote.eligibility.serviceable).toBe(true);
    expect(quote.eligibility.policy).toBe("allow");

    const scalar = await resolveDeliveryFee(db as never, { city: "مطروح" });
    expect(scalar.fee).toBe("25.00");
  });

  it("returns UNMATCHED with serviceable=false under 'reject' policy when active zones exist", async () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "reject");
    mocks.loadActiveDeliveryZones.mockResolvedValue([ZONE_CITY_CAIRO]);
    const db = makeFeeDb("25.00");

    const quote = await resolveDeliveryQuote(db as never, {
      city: "مطروح",
      area: null,
      village: null,
    });

    expect(quote.fee.fee).toBe("25.00");
    expect(quote.fee.source).toBe("DEFAULT");
    expect(quote.eligibility.status).toBe("UNMATCHED");
    expect(quote.eligibility.serviceable).toBe(false);
    expect(quote.eligibility.policy).toBe("reject");

    const directElig = await resolveDeliveryEligibility(db as never, { city: "مطروح" });
    expect(directElig.status).toBe("UNMATCHED");
    expect(directElig.serviceable).toBe(false);
  });
});

describe("createOrder — delivery eligibility enforcement & drift protection", () => {
  const customerId = "00000000-0000-4000-8000-000000000010";
  const addressId = "00000000-0000-4000-8000-000000000020";
  const cartId = "00000000-0000-4000-8000-000000000030";
  const variantId = "00000000-0000-4000-8000-000000000040";
  const idempotencyKey = "idem-elig-0001";

  function setupOrderTx(opts: { city?: string; area?: string | null; village?: string | null } = {}) {
    mocks.cartFindFirst.mockResolvedValue({ id: cartId });
    mocks.findOrderByIdempotencyKey.mockResolvedValue(null);
    mocks.findOrderByCart.mockResolvedValue(null);
    mocks.applyPromotions.mockResolvedValue({
      discountTotalCents: 0,
      freeLineSpecs: [],
      appliedPromos: [],
      couponResult: null,
    });

    const queryRaw = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM carts")) {
        return [{ id: cartId, status: "ACTIVE", expired: false }];
      }
      if (sql.includes("FROM product_codes")) {
        return [{ code: "123456", type: "BARCODE" }];
      }
      if (sql.includes("FROM categories")) {
        return [];
      }
      if (sql.includes("FROM promotions")) {
        return [];
      }
      if (sql.includes("FROM promotion_targets")) {
        return [];
      }
      if (sql.includes("UPDATE inventory")) {
        return [{ one: 1 }];
      }
      if (sql.includes("FROM store_settings")) {
        return [{ v: "25.00" }];
      }
      return [];
    });

    const tx = {
      $queryRaw: queryRaw,
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          id: customerId,
          isActive: true,
          deletedAt: null,
          firstName: "أحمد",
          lastName: "علي",
          phone: "01012345678",
        }),
      },
      customerAddress: {
        findFirst: vi.fn().mockResolvedValue({
          id: addressId,
          customerId,
          city: opts.city ?? "مطروح",
          area: opts.area ?? null,
          village: opts.village ?? null,
          street: "شارع 1",
          buildingNumber: "5",
          landmark: null,
          phone: "01012345678",
        }),
      },
      cartItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "00000000-0000-4000-8000-000000000050",
            productVariantId: variantId,
            quantity: { toString: () => "1.000" },
            unitSnapshot: "PIECE",
            unitPriceSnapshot: { toString: () => "100.00" },
          },
        ]),
      },
      productVariant: {
        findUnique: vi.fn().mockResolvedValue({
          id: variantId,
          name: "عبوة 1 كجم",
          price: { toString: () => "100.00" },
          sizeUnit: null,
          isActive: true,
          deletedAt: null,
          product: {
            id: "00000000-0000-4000-8000-000000000060",
            name: "سكر",
            productType: "PIECE",
            saleStepGrams: null,
            categoryId: "00000000-0000-4000-8000-000000000070",
            isActive: true,
            deletedAt: null,
            brand: null,
          },
        }),
      },
    };

    mocks.transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    return tx;
  }

  it("rejects UNMATCHED address with BUSINESS_RULE when DELIVERY_ELIGIBILITY_POLICY=reject", async () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "reject");
    setupOrderTx({ city: "مطروح" });
    mocks.loadActiveDeliveryZones.mockResolvedValue([ZONE_CITY_CAIRO]);

    await expect(
      createOrder({
        owner: { kind: "customer", customerId },
        customerId,
        addressId,
        guest: null,
        idempotencyKey,
        expectedDeliveryFee: "25.00",
      }),
    ).rejects.toMatchObject({
      code: "BUSINESS_RULE",
      message: "Address is outside the store's delivery areas.",
      details: {
        deliveryEligibility: "UNMATCHED",
      },
    });
  });

  it("rejects with 409 CONFLICT (DELIVERY_ELIGIBILITY_CHANGED) when expectedDeliveryEligibility drifts from live status", async () => {
    vi.stubEnv("DELIVERY_ELIGIBILITY_POLICY", "allow");
    setupOrderTx({ city: "مطروح" });
    mocks.loadActiveDeliveryZones.mockResolvedValue([ZONE_CITY_CAIRO]);

    await expect(
      createOrder({
        owner: { kind: "customer", customerId },
        customerId,
        addressId,
        guest: null,
        idempotencyKey,
        expectedDeliveryFee: "25.00",
        expectedDeliveryEligibility: "ZONE_MATCHED",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "DELIVERY_ELIGIBILITY_CHANGED",
        currentDeliveryEligibility: "UNMATCHED",
      },
    });
  });
});
