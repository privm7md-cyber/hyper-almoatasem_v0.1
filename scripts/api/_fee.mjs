// Shared delivery-fee helper for the API harness suites (D2).
//
// The storefront asserts the fee it REVIEWED on every NEW order: the server
// resolves the fee itself and always wins, and a mismatch is rejected with
// 409 DELIVERY_FEE_CHANGED. The harnesses therefore must assert the fee the
// server would resolve for the seeded fixtures.
//
// `delivery_zones` is admin-managed and is EMPTY in the seed, so the base
// setting (`store_settings.delivery.default_fee`) IS the resolved fee for
// every harness address. The helper asserts that precondition instead of
// hard-coding an amount: if a zone ever appears, the harness fails loudly
// rather than silently asserting a stale price.
export async function baseDeliveryFee(q, t) {
  const row = (await q(`SELECT value_text AS v FROM store_settings WHERE key = 'delivery.default_fee'`))[0];
  const zones = Number(
    (await q(`SELECT count(*)::int AS n FROM delivery_zones WHERE is_active`))[0]?.n ?? -1,
  );
  const fee = row?.v ?? null;
  t("delivery-fee-base-no-active-zone", fee !== null && zones === 0, `${fee}/zones=${zones}`);
  if (fee === null || zones !== 0) {
    throw new Error(`DELIVERY_FEE_UNRESOLVED: base=${fee} active_zones=${zones}`);
  }
  return fee;
}
