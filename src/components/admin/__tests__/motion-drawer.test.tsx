// DOM regressions only. Real Motion presence, no services, actions or database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";

const runtime = vi.hoisted(() => ({ reduced: true, fetch: vi.fn() }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  // Make both motion preferences testable without the runtime's cached media
  // query. AnimatePresence and all animated elements remain the real runtime.
  return { ...actual, useReducedMotion: () => runtime.reduced };
});

import { MotionConfirm, MotionDrawer } from "../ui/motion-kit";

beforeEach(() => {
  runtime.reduced = true;
  runtime.fetch.mockReset();
  runtime.fetch.mockImplementation(() => { throw new Error("Network is forbidden in drawer regressions"); });
  vi.stubGlobal("fetch", runtime.fetch);
});

afterEach(() => {
  cleanup();
  expect(runtime.fetch).not.toHaveBeenCalled();
  document.querySelectorAll("[data-drawer-test]").forEach((node) => node.remove());
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("overflow-x");
  document.body.style.removeProperty("overflow-y");
  document.body.style.removeProperty("color");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function layout(open: boolean, onClose: () => void, children: ReactNode = <input aria-label="اسم المنطقة" />, footer?: ReactNode) {
  return (
    <div>
      <main id="main" tabIndex={-1}>
        <div><button type="button">تعديل المنطقة</button></div>
        <section aria-label="محرر المنطقة">
          <button type="button">عنصر مجاور</button>
          <MotionDrawer open={open} title="تعديل منطقة التوصيل" onClose={onClose} footer={footer}>
            {children}
          </MotionDrawer>
        </section>
      </main>
      <button type="button">خارج المحرر</button>
    </div>
  );
}

function openDrawer(onClose = vi.fn(), children?: ReactNode, footer?: ReactNode) {
  const view = render(layout(false, onClose, children, footer));
  const trigger = screen.getByRole("button", { name: "تعديل المنطقة" });
  trigger.focus();
  view.rerender(layout(true, onClose, children, footer));
  const dialog = screen.getByRole("dialog", { name: "تعديل منطقة التوصيل" });
  const close = within(dialog).getByRole("button", { name: "إغلاق" });
  return { view, trigger, dialog, close, onClose };
}

describe("MotionDrawer modal lifecycle", () => {
  it("focuses and traps visible enabled controls, excludes hidden ancestors, and redirects focus escapes", () => {
    const { dialog, close } = openDrawer(vi.fn(), (
      <>
        <input aria-label="اسم المنطقة" />
        <a href="#local">مساعدة المنطقة</a>
        <select aria-label="اختيار المنطقة"><option>منطقة</option></select>
        <textarea aria-label="آخر حقل ظاهر" />
        <button type="button" disabled>معطل</button>
        <fieldset disabled><input aria-label="حقل معطل" /></fieldset>
        <input type="hidden" />
        <button type="button" tabIndex={-1}>خارج ترتيب التنقل</button>
        <div hidden><button type="button">مخفي</button></div>
        <div aria-hidden="true"><button type="button">مخفي لقارئ الشاشة</button></div>
        <div style={{ display: "none" }}><button type="button">حاوية غير معروضة</button></div>
        <div style={{ visibility: "hidden" }}><button type="button">حاوية غير مرئية</button></div>
      </>
    ), <button type="button" disabled>حفظ معطل</button>);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    const last = within(dialog).getByRole("textbox", { name: "آخر حقل ظاهر" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    screen.getByRole("button", { name: "خارج المحرر" }).focus();
    expect(close).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("inerts background branches but not dialog ancestors, preserving inert attributes and overflow priority", async () => {
    const prior = document.createElement("div");
    prior.dataset.drawerTest = "prior-inert";
    prior.setAttribute("inert", "saved");
    document.body.append(prior);
    document.body.style.setProperty("overflow", "clip", "important");
    const { view, trigger, dialog, onClose } = openDrawer();
    expect(prior).toHaveAttribute("inert", "");
    expect(trigger.closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "عنصر مجاور" })).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "خارج المحرر" })).toHaveAttribute("inert");
    expect(dialog.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    view.rerender(layout(false, onClose));
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(trigger.closest("[inert]")).toBeNull();
    expect(prior).toHaveAttribute("inert", "saved");
    expect(document.body.style.overflow).toBe("clip");
    expect(document.body.style.getPropertyPriority("overflow")).toBe("important");
  });

  it("restores separate overflow declarations without changing unrelated body styles", async () => {
    document.body.style.setProperty("overflow-x", "clip", "important");
    document.body.style.setProperty("overflow-y", "scroll");
    const { view, onClose } = openDrawer();
    // An unrelated style changed while the modal is open must survive cleanup.
    document.body.style.color = "red";
    view.rerender(layout(false, onClose));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.body.style.overflow).not.toBe("hidden");
    });
    expect(document.body.style.overflowX).toBe("clip");
    expect(document.body.style.getPropertyPriority("overflow-x")).toBe("important");
    expect(document.body.style.overflowY).toBe("scroll");
    expect(document.body.style.color).toBe("red");
    document.body.style.removeProperty("color");
  });

  it("traps an enabled footer control and falls back to the panel when all controls are disabled", () => {
    const { dialog, close, onClose } = openDrawer(vi.fn(), undefined, <button type="button">حفظ المنطقة</button>);
    const save = within(dialog).getByRole("button", { name: "حفظ المنطقة" });
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(close).toHaveFocus();
    dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>("button, input").forEach((element) => { element.disabled = true; });
    screen.getByRole("button", { name: "خارج المحرر" }).focus();
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not reset focus or the restoration target when the caller changes its close callback", async () => {
    const { view, trigger, dialog, onClose } = openDrawer();
    const input = within(dialog).getByRole("textbox", { name: "اسم المنطقة" });
    input.focus();
    const nextClose = vi.fn();
    view.rerender(layout(true, nextClose));
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(nextClose).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(layout(false, nextClose));
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it.each(["close", "backdrop"])("dismisses through the %s control without a form submission", (control) => {
    const { view, close, onClose } = openDrawer();
    const target = control === "close" ? close : view.container.querySelector<HTMLButtonElement>('.adm-drawer-backdrop button[aria-hidden="true"]')!;
    expect(target).toHaveAttribute("type", "button");
    expect(target.closest("[inert]")).toBeNull();
    fireEvent.click(target);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses immediate reduced-motion presentation and restores to main when its trigger is hidden", async () => {
    const { view, trigger, dialog, onClose } = openDrawer();
    expect(dialog.style.transform).toBe("none");
    expect(dialog.style.opacity).toBe("1");
    trigger.parentElement!.hidden = true;
    view.rerender(layout(false, onClose));
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(document.getElementById("main")).toHaveFocus();
    });
  });

  it("keeps scroll lock, inertness and focus trapping during real presence exit before restoring focus", async () => {
    runtime.reduced = false;
    const { view, trigger, dialog, close, onClose } = openDrawer();
    view.rerender(layout(false, onClose));
    expect(dialog).toBeInTheDocument();
    expect(trigger.closest("[inert]")).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    screen.getByRole("button", { name: "خارج المحرر" }).focus();
    expect(close).toHaveFocus();
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    }, { timeout: 3000 });
    expect(trigger.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("releases an exiting drawer on direct unmount and restores a still-connected opener", () => {
    runtime.reduced = false;
    const opener = document.createElement("button");
    opener.dataset.drawerTest = "external-opener";
    document.body.append(opener);
    document.body.style.overflow = "auto";
    opener.focus();
    const onClose = vi.fn();
    const view = render(layout(true, onClose));
    const dialog = screen.getByRole("dialog");
    expect(opener).toHaveAttribute("inert");
    view.rerender(layout(false, onClose));
    expect(dialog).toBeInTheDocument();
    view.unmount();
    expect(dialog).not.toBeInTheDocument();
    expect(opener).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("auto");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cleans up on direct unmount and permits reopening after StrictMode's effect replay", async () => {
    const onClose = vi.fn();
    const view = render(<StrictMode>{layout(false, onClose)}</StrictMode>);
    const trigger = screen.getByRole("button", { name: "تعديل المنطقة" });
    trigger.focus();
    view.rerender(<StrictMode>{layout(true, onClose)}</StrictMode>);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "إغلاق" })).toHaveFocus();
    expect(trigger.closest("[inert]")).not.toBeNull();
    act(() => view.unmount());
    expect(document.body.style.overflow).toBe("");
    const outside = document.createElement("button");
    outside.dataset.drawerTest = "after-unmount";
    document.body.append(outside);
    outside.focus();
    expect(outside).toHaveFocus();
    const reopened = openDrawer();
    expect(reopened.close).toHaveFocus();
    reopened.view.rerender(layout(false, reopened.onClose));
    await waitFor(() => {
      expect(reopened.dialog).not.toBeInTheDocument();
      expect(reopened.trigger).toHaveFocus();
    });
    expect(outside).not.toHaveAttribute("inert");
  });

  it("renders MotionConfirm with immediate reduced-motion exit when reduced motion is active", async () => {
    runtime.reduced = true;
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onExitComplete = vi.fn();
    const view = render(
      <MotionConfirm
        open
        question="تأكيد الحذف؟"
        confirmLabel="حذف"
        variant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
        onExitComplete={onExitComplete}
      />,
    );
    expect(screen.getByText("تأكيد الحذف؟")).toBeInTheDocument();
    view.rerender(
      <MotionConfirm
        open={false}
        question="تأكيد الحذف؟"
        confirmLabel="حذف"
        variant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
        onExitComplete={onExitComplete}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("تأكيد الحذف؟")).toBeNull();
      expect(onExitComplete).toHaveBeenCalled();
    });
  });
});
