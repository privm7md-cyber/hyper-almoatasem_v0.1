// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  classifyDeliveryAddress,
  readDeliveryPricingSettings,
} from "../delivery-pricing";

function settingsDb(rows: Array<{ key: string; value_text: string | null }>) {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) };
}

describe("Matay owner pricing", () => {
  it("reads JSON lists, charges configured Matay internally, and keeps outside coverage explicit", async () => {
    const settings = await readDeliveryPricingSettings(settingsDb([
      { key: "delivery.center_name", value_text: "مطاي" },
      { key: "delivery.center_villages", value_text: '["بردنوها","منبال"]' },
      { key: "delivery.outside_cities", value_text: '["بني مزار"]' },
      { key: "delivery.inside_fee", value_text: "20.00" },
      { key: "delivery.outside_fee", value_text: "30.00" },
    ]) as never);
    expect(settings.insideFeeCents).toBe(2000);
    expect(settings.outsideFeeCents).toBe(3000);
    expect(classifyDeliveryAddress(settings, { city: "مطاي" }).kind).toBe("MARKAZ");
    expect(classifyDeliveryAddress(settings, { city: "مطاي", village: "بردنوها" }).kind).toBe("MARKAZ");
    expect(classifyDeliveryAddress(settings, { city: "بني مزار" }).kind).toBe("OUTSIDE_APPROVED");
    expect(classifyDeliveryAddress(settings, { city: "القاهرة" }).kind).toBe("UNSUPPORTED");
  });

  it("does not open any outside location when the owner list is empty", async () => {
    const settings = await readDeliveryPricingSettings(settingsDb([
      { key: "delivery.center_name", value_text: "مطاي" },
      { key: "delivery.center_villages", value_text: "[]" },
      { key: "delivery.outside_cities", value_text: "[]" },
    ]) as never);
    expect(classifyDeliveryAddress(settings, { city: "المنيا" }).kind).toBe("UNSUPPORTED");
  });
});
