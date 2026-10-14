// FE-11 RoleDeleteButton tests: two-step destructive confirmation.
// No fetch on cancel; exact DELETE contract on confirm; 409 context preserved.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { RoleDeleteButton } from "../role-forms";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("RoleDeleteButton (FE-11 dangerous-action confirmation)", () => {
  it("asks for explicit confirmation naming irreversibility; cancel sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <RoleDeleteButton id="r-1" memberCount={0} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "حذف الدور" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/نهائيًا ولا يمكن التراجع/);
    fireEvent.click(screen.getByRole("button", { name: "تراجع" }));
    expect(screen.getByRole("button", { name: "حذف الدور" })).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the exact DELETE contract on confirm", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ToastProvider>
        <RoleDeleteButton id="r-1" memberCount={0} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "حذف الدور" }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الحذف" }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/roles/r-1");
    expect(init.method).toBe("DELETE");
  });

  it("keeps member-context and surfaces 409 without losing the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "CONFLICT", message: "الدور مرتبط.", details: null } }, 409),
      ),
    );
    render(
      <ToastProvider>
        <RoleDeleteButton id="r-1" memberCount={2} />
      </ToastProvider>,
    );
    expect(screen.getByText(/سيُرفض من الخادم/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "حذف الدور" }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الحذف" }));
    // Error Note (not the confirm alert): wait for the server message text itself.
    expect(await screen.findByText("الدور مرتبط.")).toBeVisible();
    // Confirm step dismissed after failure; base form intact for retry/cancel.
    expect(screen.getByRole("button", { name: "حذف الدور" })).toBeVisible();
  });
});
