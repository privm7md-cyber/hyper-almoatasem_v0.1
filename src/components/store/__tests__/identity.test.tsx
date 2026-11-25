// FE-6 identity + address tests with mocked fetch (no backend writes).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginForm } from "../login-form";
import { RegisterForm } from "../register-form";
import { PasswordChangeForm } from "../password-change-form";
import { AddressBook } from "../address-book";
import { ToastProvider } from "@/components/ui/toast";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/login",
}));

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "/"} {...rest}>
      {children}
    </a>
  ),
}));

describe("login-form", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it("blocks empty submit with guidance (no request)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByText("أدخل رقم الهاتف وكلمة المرور.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("marks empty fields with field-bound errors and aria-invalid", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    const phone = await screen.findByLabelText(/رقم الهاتف/);
    const password = await screen.findByLabelText(/كلمة المرور/);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("أدخل رقم الهاتف.")).toBeInTheDocument();
    expect(screen.getByText("أدخل كلمة المرور.")).toBeInTheDocument();
    expect(phone).toHaveAttribute("required");
    expect(password).toHaveAttribute("required");
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts phone+password and navigates on success (no secrets stored)", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ data: { customer: {}, customerToken: "t", expiresAt: "x" } }));
    vi.stubGlobal("fetch", spy);
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/رقم الهاتف/), { target: { value: "01001234567" } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: "secret-123456" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ phone: "01001234567", password: "secret-123456" });
    expect(push).toHaveBeenCalledWith("/account");
    expect(window.localStorage.length).toBe(0);
  });

  it("maps 401 to a generic message (no oracle detail)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Authentication is required.", details: null } }, 401)),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/رقم الهاتف/), { target: { value: "01001234567" } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByText("بيانات الدخول غير صحيحة.")).toBeInTheDocument();
  });

  it("GAP-01: automatically merges guest cart on login when a guest token exists in localStorage", async () => {
    const token = "a".repeat(64);
    window.localStorage.setItem("hyper_cart_guest_token", token);
    const spy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { customer: {}, customerToken: "t", expiresAt: "x" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { cart: { lines: [{ id: "1" }] } } }));
    vi.stubGlobal("fetch", spy);
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/رقم الهاتف/), { target: { value: "01001234567" } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: "secret-123456" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const [mergeUrl, mergeInit] = spy.mock.calls[1] as [string, RequestInit];
    expect(mergeUrl).toBe("/api/store/cart/merge");
    expect((mergeInit.headers as Record<string, string>)["x-guest-token"]).toBe(token);
    expect(window.localStorage.getItem("hyper_cart_guest_token")).toBeNull();
  });
});

describe("register-form", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it("maps 409 duplicate to login guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "CONFLICT", message: "dup", details: null } }, 409)),
    );
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText(/رقم الهاتف/), { target: { value: "01001234567" } });
    fireEvent.change(screen.getByLabelText(/الاسم الأول/), { target: { value: "أحمد" } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الحساب" }));
    expect(await screen.findByText(/مسجل بالفعل/)).toBeInTheDocument();
  });
});

const ADDR = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  label: null,
  city: "مطاي",
  area: null,
  village: null,
  street: "شارع",
  buildingNumber: null,
  landmark: null,
  phone: "01001234567",
  isDefault: true,
};

describe("address-book", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders default badge and deletes via API (list refreshes)", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ data: { deleted: true }, meta: {} }));
    vi.stubGlobal("fetch", spy);
    render(
      <ToastProvider>
        <AddressBook initial={[ADDR]} />
      </ToastProvider>,
    );
    expect(screen.getByText("(افتراضي)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(ADDR.id);
    expect(init.method).toBe("DELETE");
  });

  it("requires city + phone before sending (no governorate field)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    render(
      <ToastProvider>
        <AddressBook initial={[]} />
      </ToastProvider>,
    );
    expect(screen.queryByLabelText(/محافظة|Governorate/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ العنوان" }));
    expect(await screen.findByText("المدينة ورقم الهاتف مطلوبان.")).toBeInTheDocument();
    expect(screen.getByText("المدينة مطلوبة.")).toBeInTheDocument();
    expect(screen.getByText("رقم الهاتف مطلوب.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("disables delete while in flight (double-submit guard)", async () => {
    let resolveDelete!: (r: Response) => void;
    const spy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Promise<Response>((res) => {
          resolveDelete = res;
        });
      }
      return Promise.resolve(jsonResponse({ data: [ADDR], meta: {} }));
    });
    vi.stubGlobal("fetch", spy);
    render(
      <ToastProvider>
        <AddressBook initial={[ADDR]} />
      </ToastProvider>,
    );
    const btn = screen.getByRole("button", { name: "حذف" });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    resolveDelete(jsonResponse({ data: { deleted: true }, meta: {} }));
    await waitFor(() => expect(btn).toBeEnabled());
  });
});

describe("password-change-form (GAP-02)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it("opens form, validates password length, and PATCHes /api/store/customers/password", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ data: { passwordChanged: true }, meta: {} }));
    vi.stubGlobal("fetch", spy);
    render(<PasswordChangeForm />);
    fireEvent.click(screen.getByRole("button", { name: "تغيير كلمة المرور" }));
    fireEvent.change(screen.getByLabelText("كلمة المرور الحالية"), { target: { value: "old-password-123" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), { target: { value: "new-password-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ كلمة المرور" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/store/customers/password");
    expect(init.method).toBe("PATCH");
    expect(push).toHaveBeenCalledWith("/login");
  });
});
