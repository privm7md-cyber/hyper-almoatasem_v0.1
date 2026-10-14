// FE-11 AdminAction tests: confirm flow, single-flight, and auth-aware error hints.
// Fetch stubbed (mocked API); next/navigation router mocked. No DB, no network.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AdminAction } from "../admin-mutate";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderAction(props: { label: string; path: string; method?: "POST" | "DELETE"; confirmText?: string }) {
  return render(
    <ToastProvider>
      <AdminAction method="POST" {...props} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("AdminAction (FE-11 dangerous-action UX)", () => {
  it("requires explicit confirmation before a destructive call (cancel path safe)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderAction({ label: "حذف", path: "/api/admin/x/1", method: "DELETE", confirmText: "الحذف نهائي. تأكيد؟" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(screen.getByText("الحذف نهائي. تأكيد؟")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "تراجع" }));
    expect(screen.getByRole("button", { name: "حذف" })).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends exactly one request on confirm (double-click safe)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true }, meta: {} })));
    renderAction({ label: "حذف", path: "/api/admin/x/1", method: "DELETE", confirmText: "تأكيد؟" });
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    const confirm = screen.getByRole("button", { name: "تأكيد" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText("تم تنفيذ العملية.");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("renders the re-login hint on 401 and the permission hint on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Authentication required.", details: null } }, 401),
      ),
    );
    const { unmount } = renderAction({ label: "حفظ", path: "/api/admin/x" });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/سجّل الدخول مجددًا/);
    unmount();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "FORBIDDEN", message: "Forbidden.", details: null } }, 403),
      ),
    );
    renderAction({ label: "حفظ", path: "/api/admin/x" });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/لا تملك الصلاحية/);
  });
});
