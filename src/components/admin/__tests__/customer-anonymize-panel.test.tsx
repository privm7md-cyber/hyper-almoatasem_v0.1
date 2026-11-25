// P1208-D01 Task 2 + H2 — CustomerAnonymizePanel alignment with AnonymizeResult DTO
// across default COMPLETED/alreadyAnonymized/422 states AND H2 PENDING/FAILED/refresh states.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnonymizeResult } from "@/lib/customers/anonymize";

const refreshSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshSpy, push: vi.fn() }),
}));

import { CustomerAnonymizePanel, type AnonymizeOutcome } from "../customer-anonymize-panel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000022";
const TASK_ID = "00000000-0000-4000-8000-000000000099";
const UPDATED_AT = "2026-11-18T00:00:00.000Z";

function sampleResult(overrides: Partial<AnonymizeResult> = {}): AnonymizeResult {
  const res: AnonymizeResult = {
    anonymized: true,
    outcome: "COMPLETED_WITH_LEGAL_REVIEW",
    mode: "PSEUDONYMIZED",
    customerId: CUSTOMER_ID,
    displayName: "عميل مجهول",
    removed: {
      addresses: 2,
      sessions: 3,
      rateLimitBuckets: 4,
      auditRows: 1,
      orderRows: 5,
    },
    blockedByOpenOrders: [],
    restrictedRetained: [
      {
        location: "backups / replicas / logs خارج قاعدة البيانات",
        label: "النسخ الاحتياطية والسجلات الخارجية",
        accessScope: "مالك المتجر + المسؤول القانوني",
        requiredPermission: "audit_logs.view",
      },
    ],
    alreadyAnonymized: false,
    ...overrides,
  };
  const outcomeCheck: AnonymizeOutcome = res;
  return outcomeCheck;
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("CustomerAnonymizePanel — AnonymizeResult & H2 lifecycle contract alignment", () => {
  it("validates mandatory reason and blocks email/phone in reason before issuing any network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل اختباري"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={5}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 15000 }));

    expect(await screen.findByText("اكتب سبب إخفاء الهوية من ١ إلى ٥٠٠ حرف.", {}, { timeout: 5000 })).toBeVisible();

    fireEvent.change(screen.getByLabelText(/سبب إخفاء الهوية/), {
      target: { value: "بريد ahmed@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 15000 }));
    expect(await screen.findByText(/ما ينفعش يحتوي على بريد إلكتروني/, {}, { timeout: 5000 })).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the real AnonymizeResult payload cleanly without TypeError or [object Object]", async () => {
    const payload = sampleResult();
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ data: payload, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل اختباري"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={5}
      />,
    );

    fireEvent.change(screen.getByLabelText(/سبب إخفاء الهوية/), {
      target: { value: "طلب رسمي لإخفاء الهوية بعد اكتمال الطلبات" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 5000 }));

    const region = await screen.findByRole("region", { name: "نتيجة إخفاء الهوية" }, { timeout: 5000 });
    expect(region).toBeVisible();
    expect(region).toHaveAttribute("data-anonymize-state", "COMPLETED");
    expect(region.textContent ?? "").not.toContain("[object Object]");
    expect(region).toHaveTextContent("عميل مجهول");
    expect(region).toHaveTextContent("ربط تقني بدون هوية");
    expect(region).toHaveTextContent("والطلبات (5 طلب) زي ما هي");
    expect(region).toHaveTextContent("مراجعة قانونية أو تشغيلية منفصلة");
    expect(region).toHaveTextContent("عناوين محفوظة اتشالت: 2");
    expect(region).toHaveTextContent("جلسات دخول اتلغت: 3");
    expect(region).toHaveTextContent("مفاتيح حد المحاولات اتشالت: 4");
    expect(region).toHaveTextContent("سجلات تدقيق للعميل اتنقّت: 1");
    expect(region).toHaveTextContent("بيانات هوية وعناوين وملاحظات جوه الطلبات اتنقّت: 5");
    expect(region).toHaveTextContent("النسخ الاحتياطية والسجلات الخارجية (مالك المتجر + المسؤول القانوني)");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/customers/${CUSTOMER_ID}/anonymize`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      confirmed: true,
      reason: "طلب رسمي لإخفاء الهوية بعد اكتمال الطلبات",
      expectedUpdatedAt: UPDATED_AT,
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("renders alreadyAnonymized repeat-run state and null orderCount fallback cleanly", async () => {
    const payload = sampleResult({
      alreadyAnonymized: true,
      outcome: "COMPLETED",
      restrictedRetained: [],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: payload, meta: {} })));

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل مجهول"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/سبب إخفاء الهوية/), {
      target: { value: "إعادة التحقق من إخفاء الهوية" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 5000 }));

    const region = await screen.findByRole("region", { name: "نتيجة إخفاء الهوية" }, { timeout: 5000 });
    expect(region).toHaveTextContent("العميل مخفي الهوية بالفعل باسم «عميل مجهول»");
    expect(region).toHaveTextContent("والطلبات المحفوظة كما هي دون تغيير");
    expect(region.textContent ?? "").not.toContain("بيانات محتفظ بيها ومقيّدة الوصول");
  });

  it("renders 202 PENDING_AUDIT_REDACTION honestly and transitions to COMPLETED on status refresh", async () => {
    const pendingPayload = sampleResult({
      anonymized: false,
      outcome: "PENDING_AUDIT_REDACTION",
      auditRedactionPending: true,
      redactionTaskId: TASK_ID,
      removed: { addresses: 1, sessions: 1, rateLimitBuckets: 0, auditRows: 0, orderRows: 2 },
    });
    const completedPayload = sampleResult({
      anonymized: true,
      outcome: "COMPLETED_WITH_LEGAL_REVIEW",
      auditRedactionPending: false,
      redactionTaskId: TASK_ID,
      removed: { addresses: 0, sessions: 0, rateLimitBuckets: 0, auditRows: 2, orderRows: 2 },
      alreadyAnonymized: true,
    });

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: pendingPayload, meta: {} }, 202))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              state: "COMPLETED",
              customerId: CUSTOMER_ID,
              anonymized: true,
              result: completedPayload,
            },
            meta: {},
          },
          200,
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل اختباري"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={2}
      />,
    );

    fireEvent.change(screen.getByLabelText(/سبب إخفاء الهوية/), {
      target: { value: "إخفاء هوية عميل معدل سابقًا" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 5000 }));

    const pendingRegion = await screen.findByRole("region", { name: "نتيجة إخفاء الهوية" }, { timeout: 5000 });
    expect(pendingRegion).toHaveAttribute("data-anonymize-state", "PENDING_AUDIT_REDACTION");
    expect(pendingRegion).toHaveTextContent("PENDING_AUDIT_REDACTION");
    expect(pendingRegion).toHaveTextContent("ولم تكتمل عملية إخفاء الهوية نهائيًا بعد");
    expect(pendingRegion).toHaveTextContent(TASK_ID);

    fireEvent.click(screen.getByRole("button", { name: "تحديث حالة التنقية" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("region", { name: "نتيجة إخفاء الهوية" })).toHaveAttribute(
        "data-anonymize-state",
        "COMPLETED",
      );
    });
    expect(screen.getByRole("region", { name: "نتيجة إخفاء الهوية" })).toHaveTextContent(
      "سجلات تدقيق للعميل اتنقّت: 2",
    );
  });

  it("renders FAILED state via initialOutcome with error code, attempts, and recovery notice", () => {
    const failedOutcome = sampleResult({
      anonymized: false,
      outcome: "FAILED",
      auditRedactionPending: true,
      redactionTaskId: TASK_ID,
      attemptCount: 5,
      lastErrorCode: "SIMULATED_WORKER_CRASH",
    });

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل مجهول"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={2}
        initialOutcome={failedOutcome}
      />,
    );

    const region = screen.getByRole("region", { name: "نتيجة إخفاء الهوية" });
    expect(region).toHaveAttribute("data-anonymize-state", "FAILED");
    expect(region).toHaveTextContent("FAILED");
    expect(region).toHaveTextContent("SIMULATED_WORKER_CRASH");
    expect(region).toHaveTextContent("5");
    expect(region).toHaveTextContent("لم تكتمل عملية إخفاء الهوية نهائيًا بعد");
  });

  it("surfaces 422 open-order refusal error without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "BUSINESS_RULE",
              message: "مفيش إخفاء هوية دلوقتي: فيه 1 طلب لسه مفتوح (HM-20261118-0001).",
              details: { openOrders: ["HM-20261118-0001"] },
            },
          },
          422,
        ),
      ),
    );

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل اختباري"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={1}
      />,
    );

    fireEvent.change(screen.getByLabelText(/سبب إخفاء الهوية/), {
      target: { value: "طلب إخفاء هوية" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 5000 }));

    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/طلب لسه مفتوح/);
  });

  it("surfaces clear actionable Arabic failure alert when unmigrated DB blocks historical audit redaction (AUDIT_REDACTION_MIGRATION_REQUIRED)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "BUSINESS_RULE",
              message: "تعذّر إخفاء هوية العميل حالياً.",
              details: { reasonCode: "AUDIT_REDACTION_MIGRATION_REQUIRED", anonymized: false },
            },
          },
          422,
        ),
      ),
    );

    render(
      <CustomerAnonymizePanel
        customerId={CUSTOMER_ID}
        customerName="عميل اختباري"
        expectedUpdatedAt={UPDATED_AT}
        orderCount={1}
      />,
    );

    fireEvent.change(screen.getByLabelText(/سبب إخفاء الهوية/), {
      target: { value: "طلب رسمي لإخفاء الهوية" },
    });
    fireEvent.click(screen.getByRole("button", { name: "اخفي هوية العميل" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد إخفاء الهوية" }, { timeout: 5000 }));

    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent(/يلزم تفعيل ترحيل H2 وعامل التنقية المستقل أولاً/);
    expect(screen.getByRole("region", { name: "إخفاء هوية العميل" })).toHaveAttribute(
      "data-anonymize-state",
      "INITIAL",
    );
    expect(screen.queryByRole("region", { name: "نتيجة إخفاء الهوية" })).toBeNull();
  });
});
