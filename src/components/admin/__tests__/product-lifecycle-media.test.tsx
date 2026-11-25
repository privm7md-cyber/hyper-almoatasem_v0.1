// Isolated forms + API contracts. Modal rendering and API are doubles, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppError } from "@/lib/frontend/api-client";
import type { MediaShape } from "@/lib/catalog/serialize";
const m = vi.hoisted(() => ({ api: vi.fn(), refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/frontend/api-client", async (importOriginal) => ({ ...await importOriginal<object>(), apiRequest: m.api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/admin/ui/motion-kit", () => ({
  MotionDrawer: ({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) => open ? <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>اقفل</button></div> : null,
  MotionConfirm: ({ open, question, confirmLabel, onConfirm, onCancel, onExitComplete }: { open: boolean; question: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; onExitComplete: () => void }) => open ? <div role="alertdialog" aria-label={question}><p>{question}</p><button onClick={() => { onConfirm(); onExitComplete(); }}>{confirmLabel}</button><button onClick={() => { onCancel(); onExitComplete(); }}>تراجع</button></div> : null,
}));
import { ProductImageManager } from "../product-image-manager";
import { ProductLifecycleControls } from "../product-lifecycle-controls";

const TOKEN = "2026-11-12T10:00:00.000Z";
const image: MediaShape = { id: "image-1", url: "https://example.test/one.jpg", altText: "صورة أولى", mimeType: "image/jpeg", byteSize: 123, width: 100, height: 100, sortOrder: 1, isPrimary: true, createdAt: TOKEN };
const props = { productId: "product-1", productName: "أرز", archived: false, expectedUpdatedAt: TOKEN, canArchive: true, canRestore: true };
beforeEach(() => { vi.resetAllMocks(); m.fetch.mockImplementation(() => { throw new Error("No real network"); }); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => { cleanup(); expect(m.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function confirm(trigger: string, action: string) {
  fireEvent.click(screen.getByRole("button", { name: trigger }));
  expect(m.api).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("alertdialog");
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: action })); });
}
function register() { render(<ProductImageManager productId="product-1" images={[]} canUpdate canDelete />); }
function field(label: string) { return screen.getByLabelText(label, { exact: false }); }
function set(label: string, value: string) { fireEvent.change(field(label), { target: { value } }); }

describe("lifecycle client controls", () => {
  it("requires reason and explicit confirmation, sends current version, and waits for confirmed success", async () => {
    let resolve!: (value: unknown) => void;
    m.api.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<ProductLifecycleControls {...props} />);
    set("سبب الأرشفة", "  مراجعة  ");
    await confirm("أرشفة المنتج", "تأكيد الأرشفة");
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/catalog/products/product-1/archive", { method: "POST", body: { confirmed: true, reason: "مراجعة", expectedUpdatedAt: TOKEN } });
    expect(screen.queryByRole("status")).toBeNull(); expect(m.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "أرشفة المنتج" })).toBeDisabled();
    await act(async () => resolve({ data: { alreadyApplied: false, deletedAt: TOKEN, isActive: false, updatedAt: TOKEN }, meta: {} }));
    expect(screen.getByRole("status")).toHaveTextContent("تمت أرشفة المنتج"); expect(m.refresh).toHaveBeenCalledTimes(1);
  });
  it("blank reason has accessible field error and no request", async () => {
    render(<ProductLifecycleControls {...props} />);
    await confirm("أرشفة المنتج", "تأكيد الأرشفة");
    const input = field("سبب الأرشفة");
    expect(input).toHaveAttribute("aria-invalid", "true"); expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(m.api).not.toHaveBeenCalled();
  });
  it("confirmation cancel has no effects", async () => {
    render(<ProductLifecycleControls {...props} />); set("سبب الأرشفة", "سبب");
    fireEvent.click(screen.getByRole("button", { name: "أرشفة المنتج" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "تراجع" }));
    expect(m.api).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
  });
  it("restore explicitly remains hidden, does not send publication flags", async () => {
    m.api.mockResolvedValue({ data: { alreadyApplied: false }, meta: {} });
    render(<ProductLifecycleControls {...props} archived />); set("سبب الاستعادة", "رجوع");
    expect(screen.getByText(/الاستعادة لا تنشره تلقائيًا/)).toBeVisible();
    await confirm("استعادة المنتج كمخفي", "تأكيد الاستعادة كمخفي");
    expect(await screen.findByRole("status")).toHaveTextContent("المنتج ما زال مخفيًا");
    expect(m.api).toHaveBeenCalledWith("/api/admin/catalog/products/product-1/restore", { method: "POST", body: { confirmed: true, reason: "رجوع", expectedUpdatedAt: TOKEN } });
  });
  it("already-applied response is not presented as another transition", async () => {
    m.api.mockResolvedValue({ data: { alreadyApplied: true }, meta: {} });
    render(<ProductLifecycleControls {...props} />); set("سبب الأرشفة", "سبب");
    await confirm("أرشفة المنتج", "تأكيد الأرشفة");
    expect(await screen.findByRole("status")).toHaveTextContent("مطبّقة بالفعل");
  });
  it.each(["CONFLICT", "FORBIDDEN", "INTERNAL"] as const)("%s never shows success or refreshes", async (code) => {
    m.api.mockRejectedValue(new AppError(code, "Private server message"));
    render(<ProductLifecycleControls {...props} />); set("سبب الأرشفة", "سبب");
    await confirm("أرشفة المنتج", "تأكيد الأرشفة");
    expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.queryByRole("status")).toBeNull(); expect(m.refresh).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Private server message");
  });
  it.each([false, true])("without exact capability, archived=%s has no transition action", (archived) => {
    render(<ProductLifecycleControls {...props} archived={archived} canArchive={false} canRestore={false} />);
    expect(screen.queryByRole("button", { name: /أرشفة|استعادة|فحص/ })).toBeNull(); expect(m.api).not.toHaveBeenCalled();
  });
  it("a blocked reference keeps the hard delete out of reach, and the audit trail stays informational", async () => {
    m.api.mockResolvedValue({
      data: {
        executable: false,
        verification: "VERIFIED",
        blockedBy: ["orderItems"],
        references: [
          { key: "orderItems", label: "بنود طلبات سابقة", reason: "فيه بنود طلبات مرتبطة بالمنتج.", count: 2, protected: true },
          { key: "auditHistory", label: "سجل تغييرات المنتج", reason: "سجل التغييرات العادي بيتبقى.", count: 8, protected: false },
        ],
        metadata: { variants: 1, images: 2, codes: 3 },
        limitation: null,
      },
      meta: {},
    });
    render(<ProductLifecycleControls {...props} archived canRestore={false} canDelete />);
    fireEvent.click(screen.getByRole("button", { name: "فحص موانع الحذف" }));
    expect(await screen.findByRole("status")).toHaveTextContent("فيه مراجع تمنع الحذف النهائي");
    expect(screen.getByRole("status")).toHaveTextContent("بنود طلبات سابقة: 2");
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/catalog/products/product-1/deletion-eligibility");
    expect(screen.queryByRole("button", { name: /تأكيد الحذف|احذف المنتج/ })).toBeNull();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("an unreferenced product unlocks the final delete, with a reason and a confirmation", async () => {
    m.api.mockResolvedValue({
      data: {
        executable: true,
        verification: "VERIFIED",
        blockedBy: [],
        references: [{ key: "auditHistory", label: "سجل تغييرات المنتج", reason: "سجل التغييرات العادي بيتبقى.", count: 8, protected: false }],
        metadata: { variants: 1, images: 2, codes: 3 },
        limitation: null,
      },
      meta: {},
    });
    render(<ProductLifecycleControls {...props} archived canRestore={false} canDelete />);
    fireEvent.click(screen.getByRole("button", { name: "فحص موانع الحذف" }));
    expect(await screen.findByRole("status")).toHaveTextContent("مفيش أي مرجع محمي");
    // The delete control appears, and it needs a reason + a confirmation.
    expect(screen.getByRole("button", { name: "احذف المنتج نهائيًا" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "احذف المنتج نهائيًا" }));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/catalog/products/product-1/deletion-eligibility");
  });

  it("without the delete capability the final delete stays out of reach", async () => {
    m.api.mockResolvedValue({
      data: { executable: true, verification: "VERIFIED", blockedBy: [], references: [], metadata: { variants: 0, images: 0, codes: 0 }, limitation: null },
      meta: {},
    });
    render(<ProductLifecycleControls {...props} archived canRestore={false} />);
    fireEvent.click(screen.getByRole("button", { name: "فحص موانع الحذف" }));
    expect(await screen.findByRole("status")).toHaveTextContent("مفيش أي مرجع محمي");
    expect(screen.queryByRole("button", { name: /احذف المنتج/ })).toBeNull();
    expect(screen.getByText(/محتاج صلاحية حذف المنتجات/)).toBeVisible();
  });

  it("an unconfirmed check is shown as «تعذّر التأكد» and never as a clean result", async () => {
    m.api.mockResolvedValue({
      data: { executable: false, verification: "FAILED", blockedBy: [], references: [], metadata: { variants: 0, images: 0, codes: 0 }, limitation: null },
      meta: {},
    });
    render(<ProductLifecycleControls {...props} archived canRestore={false} canDelete />);
    fireEvent.click(screen.getByRole("button", { name: "فحص موانع الحذف" }));
    expect(await screen.findByRole("status")).toHaveTextContent("تعذّر التأكد");
    expect(screen.getByRole("status")).toHaveTextContent("متوقف احتياطًا");
    // The delete control stays out of reach while the check is unconfirmed.
    expect(screen.queryByRole("button", { name: /احذف المنتج/ })).toBeNull();
  });

  it("inspection failure is not an empty result", async () => {
    m.api.mockRejectedValue(new AppError("INTERNAL", "unexpected"));
    render(<ProductLifecycleControls {...props} archived canRestore={false} />);
    fireEvent.click(screen.getByRole("button", { name: "فحص موانع الحذف" }));
    expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("gallery metadata forms use the real supported API contract", () => {
  it("displays ordered gallery with stable id tie-breaks, primary label and no upload control", () => {
    render(<ProductImageManager productId="product-1" images={[{ ...image, id: "b", altText: "صورة ب", sortOrder: 0 }, { ...image, id: "a", altText: "صورة أ", sortOrder: 0 }, image]} canUpdate={false} canDelete={false} />);
    expect(within(screen.getByRole("list", { name: "صور المنتج بالترتيب" })).getAllByRole("img").map((node) => node.getAttribute("alt"))).toEqual(["صورة أ", "صورة ب", "صورة أولى"]);
    expect(document.querySelector('input[type="file"]')).toBeNull(); expect(screen.getByText(/رفع الملفات وتخزين الصور غير متاحين/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /تعديل بيانات الصورة|حذف بيانات الصورة|سجّل/ })).toBeNull();
  });
  it("broken image reference remains registered, not an empty gallery", () => {
    render(<ProductImageManager productId="product-1" images={[image]} canUpdate={false} canDelete={false} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status")).toHaveTextContent("بياناتها ما زالت مسجلة"); expect(screen.queryByText("مفيش صور مسجلة للمنتج ده.")).toBeNull();
  });
  it.each(["http://example.test/a.jpg", "data:image/png;base64,AAAA", "file:///tmp/a.png", "javascript:alert(1)", "/local.jpg", "https://example.test/a b.jpg"])("rejects unsafe/invalid reference %s without API", async (url) => {
    register(); set("رابط الصورة HTTPS", url); fireEvent.click(screen.getByRole("button", { name: "سجّل بيانات الصورة" }));
    const input = field("رابط الصورة HTTPS"); expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id); expect(m.api).not.toHaveBeenCalled();
  });
  it.each([["حجم الصورة بالبايت", "0"], ["العرض بالبكسل", "-1"], ["حجم الصورة بالبايت", "1.5"], ["ترتيب الصورة", "2147483648"]])("invalid %s = %s is local validation only", (label, value) => {
    register(); set("رابط الصورة HTTPS", image.url); set(label, value); fireEvent.click(screen.getByRole("button", { name: "سجّل بيانات الصورة" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0); expect(m.api).not.toHaveBeenCalled();
  });
  it("requires paired dimensions before POST", () => {
    register(); set("رابط الصورة HTTPS", image.url); set("العرض بالبكسل", "100"); fireEvent.click(screen.getByRole("button", { name: "سجّل بيانات الصورة" }));
    expect(field("العرض بالبكسل")).toHaveAttribute("aria-invalid", "true"); expect(field("الارتفاع بالبكسل")).toHaveAttribute("aria-invalid", "true"); expect(m.api).not.toHaveBeenCalled();
  });
  it("registers HTTPS URL with supported MIME, byte size, dimensions, order and primary", async () => {
    m.api.mockResolvedValue({ data: image, meta: {} }); register();
    set("رابط الصورة HTTPS", `  ${image.url}  `); set("وصف الصورة", "  وصف  "); set("نوع ملف الصورة", "image/webp"); set("حجم الصورة بالبايت", "2048"); set("العرض بالبكسل", "800"); set("الارتفاع بالبكسل", "600"); set("ترتيب الصورة", "-2");
    fireEvent.click(field("اجعل الصورة أساسية")); fireEvent.click(screen.getByRole("button", { name: "سجّل بيانات الصورة" }));
    expect(await screen.findByRole("status")).toHaveTextContent("لم يتم رفع ملف");
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/catalog/products/product-1/images", { method: "POST", body: { url: image.url, altText: "وصف", mimeType: "image/webp", byteSize: 2048, width: 800, height: 600, sortOrder: -2, isPrimary: true } });
    expect(field("رابط الصورة HTTPS")).toHaveValue(""); expect(m.refresh).toHaveBeenCalledTimes(1);
  });
  it("registration omits unavailable optional metadata instead of inventing MIME/size/dimensions", async () => {
    m.api.mockResolvedValue({ data: image, meta: {} }); register(); set("رابط الصورة HTTPS", image.url); fireEvent.click(screen.getByRole("button", { name: "سجّل بيانات الصورة" }));
    await screen.findByRole("status"); expect(m.api.mock.calls[0][1].body).toEqual({ url: image.url, altText: "", sortOrder: 0, isPrimary: false });
    expect(field("نوع ملف الصورة").querySelector('option[value="image/svg+xml"]')).toBeNull();
  });
  it("metadata edit PATCH is only alt/order/primary, not URL, bytes or dimensions", async () => {
    m.api.mockResolvedValue({ data: image, meta: {} });
    render(<ProductImageManager productId="product-1" images={[image]} canUpdate canDelete={false} />);
    fireEvent.click(screen.getByRole("button", { name: "تعديل بيانات الصورة" }));
    const drawer = await screen.findByRole("dialog", { name: "تعديل بيانات الصورة" });
    fireEvent.change(within(drawer).getByLabelText("وصف الصورة"), { target: { value: "وصف جديد" } });
    fireEvent.change(within(drawer).getByLabelText("ترتيب الصورة"), { target: { value: "5" } });
    fireEvent.click(within(drawer).getByLabelText("الصورة الأساسية"));
    fireEvent.click(within(drawer).getByRole("button", { name: "احفظ بيانات الصورة" }));
    await waitFor(() => expect(m.api).toHaveBeenCalled());
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/catalog/images/image-1", { method: "PATCH", body: { altText: "وصف جديد", sortOrder: 5, isPrimary: false } });
  });
  it("confirmed removal deletes metadata only and waits for the API", async () => {
    m.api.mockResolvedValue({ data: { deleted: true }, meta: {} });
    render(<ProductImageManager productId="product-1" images={[image]} canUpdate={false} canDelete />);
    await confirm("حذف بيانات الصورة", "تأكيد حذف البيانات فقط");
    expect(await screen.findByRole("status")).toHaveTextContent("الملف الخارجي لم يُحذف");
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/catalog/images/image-1", { method: "DELETE" });
    expect(screen.queryByRole("img")).toBeNull();
  });
  it.each(["register", "remove"])("%s rejection never reports success or removes the image", async (operation) => {
    m.api.mockRejectedValue(new AppError("FORBIDDEN", "Forbidden."));
    if (operation === "register") { register(); set("رابط الصورة HTTPS", image.url); fireEvent.click(screen.getByRole("button", { name: "سجّل بيانات الصورة" })); }
    else { render(<ProductImageManager productId="product-1" images={[image]} canUpdate={false} canDelete />); await confirm("حذف بيانات الصورة", "تأكيد حذف البيانات فقط"); }
    expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.queryByRole("status")).toBeNull(); expect(m.refresh).not.toHaveBeenCalled();
    if (operation === "remove") expect(screen.getByRole("img")).toBeVisible();
  });
});
