// Product code island ("use client") — registers a barcode or an internal code
// on a sellable shape.
//
// Contract: POST /api/admin/catalog/codes (server guard `products.create`).
// Body shape = `codeInputSchema` (strict): { productVariantId, code, type, isPrimary? }.
//
// The code column is globally UNIQUE — a duplicate surfaces as 409 and is
// reported as such. The code text is case-sensitive and must not contain
// whitespace.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminField, AdminInput, AdminSelect } from "@/components/admin/ui/controls";
import { CODE_TYPE_LABELS } from "@/lib/admin/terminology";

export function CodeCreateForm({
  variants,
}: {
  variants: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [variantId, setVariantId] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<"BARCODE" | "INTERNAL_CODE">("BARCODE");
  const [isPrimary, setIsPrimary] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (variants.length === 0) {
    return <p className="adm-hint">مفيش أشكال بيع — أضف شكل أول عشان تسجّل عليه كود.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (variantId === "") {
      setFeedback({ tone: "danger", text: "اختار شكل البيع اللي هيتسجّل عليه الكود." });
      return;
    }
    if (code.trim() === "" || /\s/.test(code.trim())) {
      setFeedback({ tone: "danger", text: "الكود مطلوب، ولازم يكون من غير مسافات." });
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/codes", {
        method: "POST",
        body: { productVariantId: variantId, code: code.trim(), type, isPrimary },
      });
      setFeedback({ tone: "success", text: "تم تسجيل الكود." });
      setCode("");
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر تسجيل الكود — راجع الكود وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField label="شكل البيع" required hint="الكود بيتسجّل على شكل واحد بس.">
        {({ inputId, describedBy }) => (
          <AdminSelect
            inputId={inputId}
            describedBy={describedBy}
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            required
          >
            <option value="">— اختر شكل البيع —</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </AdminSelect>
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField label="الكود" required hint="الأرقام أو الحروف من غير مسافات.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={64}
              dir="ltr"
              required
            />
          )}
        </AdminField>

        <AdminField label="نوع الكود" required hint="باركود بيتقرا في نقطة البيع، وكود داخلي للاستخدام الداخلي.">
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={type}
              onChange={(e) => setType(e.target.value as "BARCODE" | "INTERNAL_CODE")}
              required
            >
              <option value="BARCODE">{CODE_TYPE_LABELS.BARCODE}</option>
              <option value="INTERNAL_CODE">{CODE_TYPE_LABELS.INTERNAL_CODE}</option>
            </AdminSelect>
          )}
        </AdminField>
      </div>

      <div className="adm-field">
        <span className="adm-label">الكود الأساسي</span>
        <div className="adm-choices" role="radiogroup" aria-label="الكود الأساسي">
          <label className="adm-choice" htmlFor="cc-primary-yes">
            <input
              id="cc-primary-yes"
              type="radio"
              name="isPrimary"
              checked={isPrimary}
              onChange={() => setIsPrimary(true)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">الكود الأساسي للشكل</span>
            <span className="adm-choice-hint">اللي بيتقرا تلقائي لما المنتج بيتمسح في نقطة البيع.</span>
          </label>
          <label className="adm-choice" htmlFor="cc-primary-no">
            <input
              id="cc-primary-no"
              type="radio"
              name="isPrimary"
              checked={!isPrimary}
              onChange={() => setIsPrimary(false)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">كود عادي</span>
            <span className="adm-choice-hint">بيتسجّل مع الكود الأساسي من غير ما يغيره.</span>
          </label>
        </div>
      </div>

      {feedback ? (
        <div
          className={`adm-note ${feedback.tone === "success" ? "adm-note--accent" : "adm-note--danger"}`}
          role="alert"
        >
          <Info size={16} className="adm-note-icon" aria-hidden="true" />
          <div>{feedback.text}</div>
        </div>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          سجّل الكود
        </AdminButton>
      </div>
    </form>
  );
}
