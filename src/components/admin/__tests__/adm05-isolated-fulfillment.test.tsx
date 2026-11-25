// Real client islands/design-system controls; mocked API and router only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ api: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/frontend/api-client", () => ({ apiRequest: m.api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { OrderAction, PickForm, ProposeForm } from "../fulfillment-forms";
const path = "/api/admin/orders/isolated/cancel";
function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => { vi.resetAllMocks(); });

describe("ADM05 single-flight and confirmed cancellation UI", () => {
  it("OrderAction prevents same-tick duplicates and never announces future success", async () => {
    const wait = deferred(); m.api.mockReturnValue(wait.promise);
    render(<OrderAction path={path} label="run" successText="server succeeded" failureText="failed" />);
    const button = screen.getByRole("button", { name: "run" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(m.api).toHaveBeenCalledTimes(1); expect(screen.queryByRole("status")).toBeNull(); expect(m.refresh).not.toHaveBeenCalled();
    await act(async () => { wait.resolve({}); await wait.promise; });
    expect(screen.getByRole("status")).toHaveTextContent("server succeeded"); expect(m.refresh).toHaveBeenCalledTimes(1);
    const retry = deferred(); m.api.mockReturnValue(retry.promise);
    fireEvent.click(button); expect(screen.queryByRole("status")).toBeNull();
    await act(async () => { retry.reject(new Error("failed")); await retry.promise.catch(() => undefined); });
    expect(screen.getByRole("alert")).toBeVisible(); expect(screen.queryByRole("status")).toBeNull();
    m.api.mockResolvedValue({}); fireEvent.click(button);
    expect(await screen.findByRole("status", {}, { timeout: 10000 })).toHaveTextContent("server succeeded"); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("cancel needs nonblank reason and an explicit confirmation, and sends normalized terms", async () => {
    const wait = deferred(); m.api.mockReturnValue(wait.promise);
    render(<OrderAction path={path} label="cancel order" requireCancelReason variant="danger"
      confirm={{ question: "confirm cancellation?", confirmLabel: "confirm cancel" }} successText="cancelled" failureText="failed" />);
    expect(screen.getByRole("button", { name: "cancel order" })).toBeDisabled();
    const input = screen.getByLabelText(/سبب إلغاء الطلب/);
    fireEvent.change(input, { target: { value: "   " } }); expect(screen.getByRole("button", { name: "cancel order" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  customer request  " } });
    fireEvent.click(screen.getByRole("button", { name: "cancel order" }));
    expect(m.api).not.toHaveBeenCalled();
    // The confirm dialog is a lazily loaded island; on a loaded machine the
    // chunk needs longer than the default 1s to arrive.
    const confirm = await screen.findByRole("button", { name: "confirm cancel" }, { timeout: 10000 });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(m.api).toHaveBeenCalledExactlyOnceWith(path, { method: "POST", body: { reason: "customer request", confirmed: true } });
    expect(screen.queryByText("cancelled")).toBeNull(); expect(input).toBeDisabled();
    await act(async () => { wait.resolve({}); await wait.promise; });
    expect(screen.getByRole("status")).toHaveTextContent("cancelled");
    fireEvent.change(input, { target: { value: "new terms" } }); expect(screen.queryByRole("status")).toBeNull();
  });
  it("cancel control without a confirmation callback cannot send confirmed=true", () => {
    render(<OrderAction path={path} label="cancel" requireCancelReason successText="done" failureText="failed" />);
    fireEvent.change(screen.getByLabelText(/سبب إلغاء الطلب/), { target: { value: "reason" } });
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(m.api).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeVisible();
  });
  it.each(["0", "-1", "1.0001", "1000000000", "999999999.9999", "1e3"])("pick refuses %s with no rounding/truncation", (value) => {
    const view = render(<PickForm orderId="order" itemId="item" requested="1" unit="KG" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value } });
    fireEvent.submit(view.container.querySelector("form")!); expect(m.api).not.toHaveBeenCalled();
  });
  it("PickForm single-flight preserves exact decimal and resets only on server success", async () => {
    const wait = deferred(); m.api.mockReturnValue(wait.promise);
    const view = render(<PickForm orderId="order" itemId="item" requested="1" unit="KG" />);
    const input = screen.getByRole("textbox"); fireEvent.change(input, { target: { value: "0.475" } });
    const form = view.container.querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(m.api).toHaveBeenCalledExactlyOnceWith("/api/admin/orders/order/items/item/pick", { method: "POST", body: { actualQuantity: "0.475" } });
    expect(input).toHaveValue("0.475"); expect(m.refresh).not.toHaveBeenCalled();
    await act(async () => { wait.resolve({}); await wait.promise; });
    expect(input).toHaveValue(""); expect(m.refresh).toHaveBeenCalledTimes(1);
  });
  it("failed pick keeps entered fact and permits retry after clearing failure", async () => {
    m.api.mockRejectedValueOnce(new Error("failed"));
    const view = render(<PickForm orderId="order" itemId="item" requested="1" unit="KG" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1" } });
    await act(async () => { fireEvent.submit(view.container.querySelector("form")!); });
    expect(screen.getByRole("textbox")).toHaveValue("1"); expect(m.refresh).not.toHaveBeenCalled();
    m.api.mockResolvedValueOnce({});
    await act(async () => { fireEvent.submit(view.container.querySelector("form")!); });
    expect(m.api).toHaveBeenCalledTimes(2); expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it("ProposeForm same-tick submits once and clears inputs only after success", async () => {
    const wait = deferred(); m.api.mockReturnValue(wait.promise);
    const view = render(<ProposeForm orderId="order" lines={[{ id: "item", label: "original" }]} />);
    const variant = screen.getByLabelText(/رقم الشكل البيعي البديل/); const quantity = screen.getByLabelText(/كمية البديل/);
    fireEvent.change(variant, { target: { value: "substitute" } }); fireEvent.change(quantity, { target: { value: "1.125" } });
    act(() => { fireEvent.submit(view.container.querySelector("form")!); fireEvent.submit(view.container.querySelector("form")!); });
    expect(m.api).toHaveBeenCalledTimes(1); expect(variant).toHaveValue("substitute"); expect(m.refresh).not.toHaveBeenCalled();
    await act(async () => { wait.resolve({}); await wait.promise; });
    expect(variant).toHaveValue(""); expect(quantity).toHaveValue(""); expect(m.refresh).toHaveBeenCalledTimes(1);
  });
});
