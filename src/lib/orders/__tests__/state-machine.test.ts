import { describe, expect, it } from "vitest";
import { canCancelInBa6, canTransition, isTerminal, ORDER_STATUSES } from "@/lib/orders/state-machine";

describe("order state machine", () => {
  it("keeps the frozen transition table", () => {
    expect(canTransition("NEW", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PREPARING")).toBe(true);
    expect(canTransition("PREPARING", "READY_FOR_DELIVERY")).toBe(true);
    expect(canTransition("READY_FOR_DELIVERY", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
  });

  it("allows cancel from exactly NEW|CONFIRMED|PREPARING", () => {
    expect(ORDER_STATUSES.filter(canCancelInBa6)).toEqual(["NEW", "CONFIRMED", "PREPARING"]);
  });

  it("treats DELIVERED and CANCELLED as terminal", () => {
    expect(ORDER_STATUSES.filter(isTerminal)).toEqual(["DELIVERED", "CANCELLED"]);
  });
});
