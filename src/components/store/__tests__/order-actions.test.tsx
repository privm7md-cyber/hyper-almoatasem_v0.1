// D6 items 11, 17, 18, 19 — the order action island.
//
// The island is the ONLY place where the customer learns whether a cancel or a
// replacement decision succeeded. Four properties are pinned here:
//
//   * item 11 — an AMBIGUOUS outcome (timeout / network failure) is never
//     announced as a success. The message comes from the server re-read, not
//     from the click.
//   * item 17 — the action button REMOVES ITSELF once the action settles, so
//     the keyboard focus must not fall back to <body>.
//   * item 18 — the outcome is announced through a live region that already
//     exists in the DOM BEFORE the message arrives (a region that is created
//     together with the text is not announced by most screen readers).
//   * item 19 — the focus lands on the result line: a meaningful, non-empty
//     target the keyboard user can continue from.
//
// No network, no DB: the server action adapter is mocked; the server-side
// behaviour (reconciliation, ownership) is asserted by the live harness.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { ToastProvider } from "@/components/ui/toast";

const { cancelOrderAction, decideReplacementAction, refresh } = vi.hoisted(() => ({
  cancelOrderAction: vi.fn(),
  decideReplacementAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/app/actions/orders", () => ({ cancelOrderAction, decideReplacementAction }));

import { CancelButton, DecideButtons } from "../order-actions";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";

const SUCCESS_COPY = "تم إلغاء الطلب.";
const AMBIGUOUS_COPY = "لم نتمكن من تأكيد نتيجة الإلغاء.";

/** The result line is the only `p[role=status]` — a toast item is a div. */
function resultLine(container: HTMLElement): HTMLParagraphElement {
  const node = container.querySelector('p[role="status"]');
  if (!node) throw new Error("RESULT_LINE_MISSING");
  return node as HTMLParagraphElement;
}

function renderIsland(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("D6 — cancel action (items 11, 17, 18, 19)", () => {
  it("exposes a live region BEFORE any result exists (item 18)", () => {
    const { container } = renderIsland(<CancelButton orderId={ORDER_ID} canCancel />);
    const region = resultLine(container);
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "إلغاء الطلب" })).toBeInTheDocument();
  });

  it("writes the confirmed result into that same live region (item 18)", async () => {
    cancelOrderAction.mockResolvedValue({ ok: true });
    const { container } = renderIsland(<CancelButton orderId={ORDER_ID} canCancel />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الطلب" }));
    await waitFor(() => expect(resultLine(container)).toHaveTextContent(SUCCESS_COPY));
  });

  it("moves the focus to the result when the button removes itself (items 17 + 19)", async () => {
    cancelOrderAction.mockResolvedValue({ ok: true });
    const { container } = renderIsland(<CancelButton orderId={ORDER_ID} canCancel />);
    const button = screen.getByRole("button", { name: "إلغاء الطلب" });
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    await waitFor(() => expect(resultLine(container)).toHaveTextContent(SUCCESS_COPY));

    // The button is gone; the focus must NOT have fallen back to <body>.
    expect(screen.queryByRole("button", { name: "إلغاء الطلب" })).not.toBeInTheDocument();
    // The focus move runs in an effect after the result render; under full-suite
    // load that effect can land one tick after the text assertion.
    await waitFor(() => expect(document.activeElement).toBe(resultLine(container)));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("never announces success for an ambiguous outcome (item 11)", async () => {
    cancelOrderAction.mockResolvedValue({
      ok: false,
      code: "TRANSPORT",
      message: AMBIGUOUS_COPY,
      ambiguous: true,
    });
    const { container } = renderIsland(<CancelButton orderId={ORDER_ID} canCancel />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الطلب" }));

    await screen.findByText(AMBIGUOUS_COPY);
    // No success copy anywhere — not in the live region, not in a toast.
    expect(screen.queryAllByText(SUCCESS_COPY)).toHaveLength(0);
    expect(resultLine(container)).not.toHaveTextContent(SUCCESS_COPY);
    expect(resultLine(container)).toHaveTextContent(AMBIGUOUS_COPY);
  });

  it("keeps the action available after a confirmed rejection (retry stays possible)", async () => {
    cancelOrderAction.mockResolvedValue({
      ok: false,
      code: "CONFLICT",
      message: "لم يعد الإجراء متاحًا لحالة الطلب الحالية. حدّث الحالة للمتابعة.",
    });
    renderIsland(<CancelButton orderId={ORDER_ID} canCancel />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الطلب" }));

    await screen.findByText(/لم يعد الإجراء متاحًا/);
    expect(screen.getByRole("button", { name: "إلغاء الطلب" })).toBeInTheDocument();
  });

  it("shows the Arabic rate-limit copy, never a missing-order copy (item 12)", async () => {
    cancelOrderAction.mockResolvedValue({
      ok: false,
      code: "RATE_LIMITED",
      message: "عدد المحاولات كبير. حاول مرة أخرى بعد قليل.",
    });
    const { container } = renderIsland(<CancelButton orderId={ORDER_ID} canCancel />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الطلب" }));

    await screen.findByText("عدد المحاولات كبير. حاول مرة أخرى بعد قليل.");
    expect(resultLine(container)).toHaveTextContent("عدد المحاولات كبير. حاول مرة أخرى بعد قليل.");
    // A throttled action is not a missing order.
    expect(screen.queryAllByText(/غير موجود|تعذر العثور على الطلب/)).toHaveLength(0);
  });

  it("renders no control at all when the action is not offered", () => {
    renderIsland(<CancelButton orderId={ORDER_ID} canCancel={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no axe violations on the order operation controls (item 20)", async () => {
    const { container } = renderIsland(
      <>
        <CancelButton orderId={ORDER_ID} canCancel />
        <DecideButtons orderId={ORDER_ID} replacementId={REPLACEMENT_ID} decided={false} />
      </>,
    );
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("D6 — replacement decision (items 11, 17, 18, 19)", () => {
  it("announces the confirmed decision and keeps the focus meaningful", async () => {
    decideReplacementAction.mockResolvedValue({ ok: true });
    const { container } = renderIsland(
      <DecideButtons orderId={ORDER_ID} replacementId={REPLACEMENT_ID} decided={false} />,
    );
    const approve = screen.getByRole("button", { name: "قبول البديل" });
    approve.focus();
    fireEvent.click(approve);

    await waitFor(() => expect(resultLine(container)).toHaveTextContent("تم قبول البديل."));
    expect(screen.queryByRole("button", { name: "قبول البديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "رفض البديل" })).not.toBeInTheDocument();
    // Focus is moved by an effect after the confirmed-result render; wait for
    // that accessibility side effect rather than racing the commit under a
    // heavily parallel full-suite run.
    await waitFor(() => expect(document.activeElement).toBe(resultLine(container)));
  });

  it("never announces a decision for an ambiguous outcome (item 11)", async () => {
    decideReplacementAction.mockResolvedValue({
      ok: false,
      code: "TRANSPORT",
      message: "لم نتمكن من تأكيد نتيجة القرار.",
      ambiguous: true,
    });
    const { container } = renderIsland(
      <DecideButtons orderId={ORDER_ID} replacementId={REPLACEMENT_ID} decided={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "رفض البديل" }));

    await screen.findByText("لم نتمكن من تأكيد نتيجة القرار.");
    expect(screen.queryAllByText("تم رفض البديل.")).toHaveLength(0);
    expect(screen.queryAllByText("تم قبول البديل.")).toHaveLength(0);
    expect(resultLine(container)).toHaveTextContent("لم نتمكن من تأكيد نتيجة القرار.");
  });

  it("shows the Arabic rate-limit copy for a throttled decision (item 12)", async () => {
    decideReplacementAction.mockResolvedValue({
      ok: false,
      code: "RATE_LIMITED",
      message: "عدد المحاولات كبير. حاول مرة أخرى بعد قليل.",
    });
    renderIsland(
      <DecideButtons orderId={ORDER_ID} replacementId={REPLACEMENT_ID} decided={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "قبول البديل" }));
    await screen.findByText("عدد المحاولات كبير. حاول مرة أخرى بعد قليل.");
  });

  it("renders no control at all when the proposal is already decided", () => {
    renderIsland(
      <DecideButtons orderId={ORDER_ID} replacementId={REPLACEMENT_ID} decided />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
