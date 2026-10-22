// Phase-10 admin permission gate tests.
//
// The gate is the frontend half of the permission contract: a write control is
// rendered ONLY when the session snapshot holds the EXACT key the server route
// enforces; otherwise the operator is told which key is missing. These are
// component-level proofs (mocked identity, no DB, no network) — the SERVER
// side of the same contract is enforced in src/lib/auth/rbac.ts and is proven
// by the backend suites (t-rbac-guards / t-rbac-races), not here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionGate } from "@/components/admin/permission-gate";

afterEach(() => {
  vi.resetAllMocks();
});

describe("PermissionGate (admin write-control visibility)", () => {
  it("renders the control when the required key is held", () => {
    render(
      <PermissionGate permissions={["products.view", "products.update"]} required="products.update">
        <button type="button">حفظ المنتج</button>
      </PermissionGate>,
    );
    expect(screen.getByRole("button", { name: "حفظ المنتج" })).toBeVisible();
    expect(screen.queryByText(/لا تملك صلاحية/)).toBeNull();
  });

  it("hides the control and names the missing key when the key is absent", () => {
    render(
      <PermissionGate permissions={["products.view"]} required="products.update" action="تعديل المنتج">
        <button type="button">حفظ المنتج</button>
      </PermissionGate>,
    );
    expect(screen.queryByRole("button", { name: "حفظ المنتج" })).toBeNull();
    // The refusal is textual — never colour-only — and names the exact key.
    expect(screen.getByText("products.update")).toBeVisible();
    expect(screen.getByText(/تعديل المنتج غير متاح لحسابك/)).toBeVisible();
  });

  it("treats a view-only role as unable to perform the write", () => {
    render(
      <PermissionGate permissions={["inventory.view"]} required="inventory.adjust">
        <button type="button">حفظ التعديل</button>
      </PermissionGate>,
    );
    expect(screen.queryByRole("button", { name: "حفظ التعديل" })).toBeNull();
    expect(screen.getByText("inventory.adjust")).toBeVisible();
  });
});
