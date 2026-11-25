// D6 item 12 (§5.3) — a throttled order read must NEVER be rendered as a
// missing order.
//
// Before the fix, `/orders/[id]` and `/order-confirmation/[id]` fell through to
// `notFound()` for every non-authentication read error, so a RATE_LIMITED read
// told the customer that their OWN order does not exist — a false statement
// about their data, and it also masked the difference between "throttled" and
// "gone". These tests pin the four distinct read states of both pages.
//
// No DB, no network: the read module is mocked. The server-side classification
// of a throttled read is asserted by the live harness.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOT_FOUND = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/orders",
}));

const getOrderDetail = vi.fn();
vi.mock("@/lib/frontend/order-reads", () => ({
  getOrderDetail: (...args: unknown[]) => getOrderDetail(...args),
}));

import OrderDetailPage from "../[id]/page";
import OrderConfirmationPage from "../../order-confirmation/[id]/page";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const RATE_LIMITED_HEADLINE = "عدد الطلبات كبير في الوقت الحالي";

async function renderDetailPage() {
  const ui = await OrderDetailPage({ params: Promise.resolve({ id: PAGE_ID }) });
  return render(ui);
}

async function renderConfirmationPage() {
  const ui = await OrderConfirmationPage({ params: Promise.resolve({ id: PAGE_ID }) });
  return render(ui);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("D6 — order read states (item 12)", () => {
  it("renders the Arabic rate-limit notice on the order page, not a 404", async () => {
    getOrderDetail.mockResolvedValue({ error: "RATE_LIMITED" });
    await renderDetailPage();
    expect(screen.getByText(RATE_LIMITED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(/انتظر قليلًا ثم أعد المحاولة/)).toBeInTheDocument();
    // A throttled read leaks no limiter internals.
    expect(document.body.textContent).not.toMatch(/bucket|window|attempts|limit/i);
  });

  it("renders the Arabic rate-limit notice on the confirmation page, not a 404", async () => {
    getOrderDetail.mockResolvedValue({ error: "RATE_LIMITED" });
    await renderConfirmationPage();
    expect(screen.getByText(RATE_LIMITED_HEADLINE)).toBeInTheDocument();
  });

  it("keeps the ownership gate for an unauthenticated read", async () => {
    getOrderDetail.mockResolvedValue({ error: "UNAUTHENTICATED" });
    await renderDetailPage();
    expect(screen.getByText("الوصول إلى الطلب يتطلب إثبات ملكية")).toBeInTheDocument();
    expect(screen.queryByText(RATE_LIMITED_HEADLINE)).not.toBeInTheDocument();
  });

  it("keeps the expiry notice for an expired credential (GONE)", async () => {
    getOrderDetail.mockResolvedValue({ error: "GONE" });
    await renderDetailPage();
    expect(screen.getByText("انتهت صلاحية الوصول إلى هذا الطلب")).toBeInTheDocument();
  });

  it("still answers notFound() for an unknown order", async () => {
    getOrderDetail.mockResolvedValue({ error: "NOT_FOUND" });
    await expect(OrderDetailPage({ params: Promise.resolve({ id: PAGE_ID }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("still answers notFound() for an unknown order on the confirmation page", async () => {
    getOrderDetail.mockResolvedValue({ error: "NOT_FOUND" });
    await expect(
      OrderConfirmationPage({ params: Promise.resolve({ id: PAGE_ID }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
