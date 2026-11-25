"use client";
// ADM-08 — the coupon preview.
//
// The preview is NOT a calculator in the browser: the button calls the backend
// preview endpoint, which runs the SAME rules the checkout runs
// (`evaluateCouponEligibility`) against the real coupon row. The screen shows
// the rules, whether each one is satisfied right now, and the exact message
// the customer would see when it is not.
import { useState } from "react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminRetryButton } from "@/components/admin/ui/controls";

function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="adm-error" role="alert">
      {text}
    </p>
  );
}

interface PreviewCondition {
  code: string;
  satisfied: boolean;
  requiresBasket?: boolean;
  messageAr: string;
  messageEn: string;
}

interface PreviewPayload {
  code: string;
  status: string;
  discount: {
    type: string;
    percent: string | null;
    amount: string | null;
    maximumDiscount: string | null;
    offerName: string;
  };
  limits: {
    minimumOrderAmount: string | null;
    usageLimit: number | null;
    usedCount: number;
    perCustomerLimit: number | null;
    startAt: string | null;
    endAt: string | null;
  };
  basket: { provided: boolean; lineCount: number; eligibleLineCount: number };
  applicable: boolean;
  blockedBy: string | null;
  amount: string | null;
  base: string | null;
  conditions: PreviewCondition[];
  targets: string[];
}

export function CouponPreview({ couponId }: { couponId: string }) {
  const [data, setData] = useState<PreviewPayload | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest<PreviewPayload>(
        `/api/admin/coupons/${couponId}/preview`,
        { method: "POST", body: {} },
      );
      setData(response.data);
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نحسب المعاينة دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="adm-cell-main">
      <button
        type="button"
        className="adm-btn adm-btn--secondary"
        onClick={() => void run()}
        disabled={pending}
      >
        {pending ? "بنحسب…" : "شوف معاينة الكود"}
      </button>
      {error ? (
        <>
          <FormError text={error} /> <AdminRetryButton />
        </>
      ) : null}
      {data ? (
        <div className="adm-cell-main">
          <p className="adm-cell-sub">
            {data.applicable
              ? `الكود يشتغل دلوقتي${data.amount ? ` ويخصم ${data.amount} ج.م` : ""}.`
              : "الكود مش هيشتغل بالشكل ده دلوقتي."}
          </p>
          <ul className="adm-cell-sub">
            {data.conditions.map((condition) => (
              <li key={condition.code}>
                {condition.satisfied
                  ? `✅ ${condition.messageAr}`
                  : condition.requiresBasket
                    ? `ℹ️ ${condition.messageAr} (يتحدد حسب سلة العميل)`
                    : `⛔ ${condition.messageAr}`}
              </li>
            ))}
          </ul>
          {data.targets.length > 0 ? (
            <p className="adm-cell-sub">
              الاستهداف بيتم على مستوى العرض: {data.targets.length} عنصر. مفيش استثناءات على مستوى الكود.
            </p>
          ) : (
            <p className="adm-cell-sub">
              العرض اللي ورا الكود مالهوش استهداف صريح — بيخصم كل المنتجات.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
