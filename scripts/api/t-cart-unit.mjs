// BA-5 cart unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-cart-unit.mjs
// Covers: exact money math (no float), session token shape/hash, owner XOR,
// Zod boundary shapes (strict, no coercion, XOR rule).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ qtyToThousandths, priceToPiastres, lineTotalPiastres, cartSubtotalPiastres, formatPiastres }] = await Promise.all([
  import("../../src/lib/cart/totals.ts"),
]);
const session = await import("../../src/lib/cart/session.ts");
const ownerMod = await import("../../src/lib/cart/owner.ts");
const validation = await import("../../src/lib/cart/validation.ts");
const { orderLockIds } = await import("../../src/lib/api/concurrency.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "cart-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

// --- exact money math (frozen ROUND(qty*price,2)) ---
t("line-2x15", lineTotalPiastres("2", "15.00") === 3000);
t("line-0.125x333.33", lineTotalPiastres("0.125", "333.33") === 4167);
t("line-0.5x320", lineTotalPiastres("0.500", "320.00") === 16000);
t("line-0.475x320", lineTotalPiastres("0.475", "320.00") === 15200);
t("line-null-price", lineTotalPiastres("2", null) === null);
t("subtotal-sums-priced", cartSubtotalPiastres([
  { quantity: "2", unitPrice: "15.00" },
  { quantity: "0.500", unitPrice: "320.00" },
  { quantity: "1", unitPrice: null },
]) === 19000);
t("format-piastres", formatPiastres(19000) === "190.00" && formatPiastres(5) === "0.05" && formatPiastres(0) === "0.00");
t("price-parse", priceToPiastres("15.00") === 1500 && priceToPiastres("15") === 1500 && priceToPiastres("0.05") === 5);
t("qty-thousandths", qtyToThousandths("0.125") === 125 && qtyToThousandths("500.000") === 500000);

// --- session tokens ---
const tok = session.mintGuestToken();
t("token-shape", session.isGuestTokenShape(tok) && tok.length === 64);
t("token-random", session.mintGuestToken() !== session.mintGuestToken());
t("token-hash-stable", session.hashGuestToken(tok) === session.hashGuestToken(tok) && session.hashGuestToken(tok).length === 64);
t("token-hash-hides-raw", session.hashGuestToken(tok) !== tok);
t("token-shape-reject", !session.isGuestTokenShape("short") && !session.isGuestTokenShape("") && !session.isGuestTokenShape("x".repeat(63)));

// --- owner XOR (Request필요: use fetch Request) ---
const req = (token, customerId) => {
  const headers = token ? { "x-guest-token": token } : {};
  const url = customerId ? `http://x/cart?customerId=${customerId}` : "http://x/cart";
  return new Request(url, { headers });
};
const CID = "04800000-0000-7000-8000-000000000001";
t("owner-guest", (() => {
  const o = ownerMod.resolveOwner(req(tok, null), null);
  return o !== null && o.kind === "guest" && o.sessionHash === session.hashGuestToken(tok);
})());
t("owner-customer-query", (() => {
  const o = ownerMod.resolveOwner(req(null, CID), CID);
  return o !== null && o.kind === "customer";
})());
t("owner-neither-400", ownerMod.resolveOwner(req(null, null), null) === null);
t("owner-both-400", ownerMod.resolveOwner(req(tok, CID), CID) === null);
t("owner-bad-token-400", ownerMod.resolveOwner(req("not-a-token", null), null) === null);
t("owner-bad-uuid-400", ownerMod.resolveOwner(req(null, null), "nope") === null);

// --- boundary schemas ---
const { cartItemAddSchema, cartItemSetSchema, cartMergeSchema, ownerRefSchema, cartQuantitySchema } = validation;
t("qty-wire-ok", cartQuantitySchema.safeParse("0.125").success && cartQuantitySchema.safeParse("2").success);
t("qty-wire-no", !cartQuantitySchema.safeParse("0").success && !cartQuantitySchema.safeParse("-1").success
  && !cartQuantitySchema.safeParse("0.1234").success && !cartQuantitySchema.safeParse(2).success
  && !cartQuantitySchema.safeParse("abc").success);
t("add-requires-variant-qty", cartItemAddSchema.safeParse({ productVariantId: CID, quantity: "1" }).success
  && !cartItemAddSchema.safeParse({ quantity: "1" }).success
  && !cartItemAddSchema.safeParse({ productVariantId: CID, quantity: "0" }).success);
t("add-strict", !cartItemAddSchema.safeParse({ productVariantId: CID, quantity: "1", price: "5.00" }).success);
t("set-strict", cartItemSetSchema.safeParse({ quantity: "3" }).success
  && !cartItemSetSchema.safeParse({ quantity: "0" }).success);
t("merge-requires-customer", cartMergeSchema.safeParse({ customerId: CID }).success
  && !cartMergeSchema.safeParse({}).success
  && !cartMergeSchema.safeParse({ customerId: CID, guestToken: tok }).success);
t("owner-schema-xor", ownerRefSchema.safeParse({ customerId: CID }).success
  && ownerRefSchema.safeParse({ guestToken: tok }).success
  && !ownerRefSchema.safeParse({}).success
  && !ownerRefSchema.safeParse({ customerId: CID, guestToken: tok }).success
  && !ownerRefSchema.safeParse({ customerId: CID, admin: true }).success);
t("lock-order-asc", JSON.stringify(orderLockIds(["b", "a"])) === JSON.stringify(["a", "b"]));

done();
