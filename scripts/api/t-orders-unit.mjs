// BA-6 orders unit tests (no database, no server, no secrets).
// Run: node scripts/api/t-orders-unit.mjs
// Covers: frozen state matrix (exact names, guarded transitions),
// order-number format, Zod boundaries (strict, key shape, status enum).
import { register } from "node:module";
register("./ts-resolve-hook.mjs", import.meta.url);
const [{ ORDER_STATUSES, canTransition, isTerminal, canCancelInBa6, formatOrderNumber }] = await Promise.all([
  import("../../src/lib/orders/state-machine.ts"),
]);
const validation = await import("../../src/lib/orders/validation.ts");

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "orders-unit", total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

// --- exact frozen states (7, verbatim) ---
t("seven-states", ORDER_STATUSES.length === 7
  && ["NEW", "CONFIRMED", "PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]
    .every((s) => ORDER_STATUSES.includes(s)));
t("no-invented-states", !ORDER_STATUSES.includes("PENDING") && !ORDER_STATUSES.includes("PROCESSING")
  && !ORDER_STATUSES.includes("COMPLETED") && !ORDER_STATUSES.includes("STOCK_FAILED"));

// --- frozen transition table ---
t("new-paths", canTransition("NEW", "CONFIRMED") && canTransition("NEW", "CANCELLED")
  && !canTransition("NEW", "PREPARING") && !canTransition("NEW", "DELIVERED") && !canTransition("NEW", "NEW"));
t("confirmed-paths", canTransition("CONFIRMED", "PREPARING") && canTransition("CONFIRMED", "CANCELLED")
  && !canTransition("CONFIRMED", "NEW") && !canTransition("CONFIRMED", "DELIVERED"));
t("preparing-paths", canTransition("PREPARING", "READY_FOR_DELIVERY") && canTransition("PREPARING", "CANCELLED")
  && !canTransition("PREPARING", "CONFIRMED") && !canTransition("PREPARING", "DELIVERED"));
t("delivery-chain", canTransition("READY_FOR_DELIVERY", "OUT_FOR_DELIVERY")
  && !canTransition("READY_FOR_DELIVERY", "DELIVERED") && !canTransition("READY_FOR_DELIVERY", "CANCELLED")
  && canTransition("OUT_FOR_DELIVERY", "DELIVERED") && !canTransition("OUT_FOR_DELIVERY", "CANCELLED"));
t("terminals-closed", !canTransition("DELIVERED", "CANCELLED") && !canTransition("CANCELLED", "NEW")
  && !canTransition("DELIVERED", "DELIVERED"));
t("unknown-states", !canTransition("NEW", "BOGUS") && !canTransition("BOGUS", "NEW"));
t("is-terminal", isTerminal("DELIVERED") && isTerminal("CANCELLED") && !isTerminal("CONFIRMED") && !isTerminal("NEW"));
t("ba6-cancel-scope", canCancelInBa6("NEW") && canCancelInBa6("CONFIRMED")
  && !canCancelInBa6("PREPARING") && !canCancelInBa6("DELIVERED") && !canCancelInBa6("CANCELLED"));

// --- order number format (HM-YYYYMMDD-######) ---
t("order-number-format", formatOrderNumber("20260926", 42) === "HM-20260926-000042"
  && formatOrderNumber("20260926", 1234567) === "HM-20260926-1234567"
  && /^HM-[0-9]{8}-[0-9]{6,}$/.test(formatOrderNumber("20260926", 7)));

// --- boundaries ---
const { orderCreateSchema, orderListQuerySchema, adminOrderListQuerySchema, orderCancelSchema } = validation;
const CID = "04800000-0000-7000-8000-000000000001";
t("create-shape", orderCreateSchema.safeParse({ customerId: CID, addressId: CID, idempotencyKey: "k-0001" }).success);
t("create-rejects", !orderCreateSchema.safeParse({ customerId: CID, addressId: CID }).success
  && !orderCreateSchema.safeParse({ customerId: CID, addressId: CID, idempotencyKey: "has space" }).success
  && !orderCreateSchema.safeParse({ customerId: CID, addressId: CID, idempotencyKey: "" }).success
  && !orderCreateSchema.safeParse({ customerId: CID, addressId: CID, idempotencyKey: "k", notes: "x" }).success
  && !orderCreateSchema.safeParse({ customerId: CID, addressId: CID, idempotencyKey: "k", cartId: CID }).success);
t("list-requires-customer", orderListQuerySchema.safeParse({ customerId: CID }).success
  && !orderListQuerySchema.safeParse({}).success);
t("admin-status-enum", adminOrderListQuerySchema.safeParse({ status: "CONFIRMED" }).success
  && !adminOrderListQuerySchema.safeParse({ status: "PENDING" }).success
  && !adminOrderListQuerySchema.safeParse({ status: "COMPLETED" }).success);
t("cancel-shape", orderCancelSchema.safeParse({ customerId: CID }).success
  && !orderCancelSchema.safeParse({}).success);

done();
