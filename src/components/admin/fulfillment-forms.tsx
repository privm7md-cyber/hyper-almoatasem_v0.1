// ADMIN FULFILLMENT FORMS — the only hydrated island of the orders screen.
//
// Every write goes through the admin API with the session cookie, and every
// sentence the operator reads is Arabic: the server's own wording is
// translated by adminErrorMessage instead of being echoed. The admin panel
// has no toast host, so each control reports its outcome inline, right
// where the operator is looking.

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { boundedThousandths } from "@/lib/inventory/quantities";
import { adminCancelSchema } from "@/lib/orders/validation";
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminSelect,
  AdminTextarea,
  ConfirmButton,
} from "@/components/admin/ui/controls";

/* --------------------------------------------------------------- action */

/**
 * One order-level write. The label says what the button DOES; the optional
 * confirmation stands between the operator and a write that cannot be undone.
 */
export function OrderAction({
  path,
  label,
  body,
  confirm,
  requireCancelReason = false,
  variant = "primary",
  size = "md",
  successText,
  failureText,
}: {
  path: string;
  label: string;
  body?: Record<string, unknown>;
  confirm?: { question: string; confirmLabel: string };
  requireCancelReason?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  successText: string;
  failureText: string;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function run(confirmed = false) {
    if (inFlight.current) return;
    setDone(null);
    setFailed(null);
    let payload = body;
    if (requireCancelReason) {
      const parsed = adminCancelSchema.safeParse({ reason, confirmed });
      if (!parsed.success) {
        setFailed("اكتب سبب الإلغاء (حتى 2000 حرف) وأكّد الإلغاء.");
        return;
      }
      payload = parsed.data;
    }
    inFlight.current = true;
    setPending(true);
    try {
      await apiRequest(path, { method: "POST", body: payload });
      setDone(successText);
      router.refresh();
    } catch (error) {
      setFailed(adminErrorMessage(error, failureText));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="adm-action-stack">
      {requireCancelReason ? (
        <AdminField label="سبب إلغاء الطلب" required>
          {({ inputId, describedBy }) => (
            <AdminTextarea inputId={inputId} describedBy={describedBy} value={reason}
              disabled={pending} maxLength={2000}
              onChange={(event) => { setReason(event.target.value); setDone(null); setFailed(null); }} />
          )}
        </AdminField>
      ) : null}
      {confirm ? (
        <ConfirmButton
          label={label}
          confirmLabel={confirm.confirmLabel}
          question={confirm.question}
          variant={variant}
          size={size}
          disabled={pending || (requireCancelReason && reason.trim() === "")}
          onConfirm={() => void run(true)}
        />
      ) : (
        <AdminButton variant={variant} size={size} loading={pending} onClick={() => void run()}>
          {label}
        </AdminButton>
      )}
      {failed ? (
        <span className="adm-error" role="alert">
          {failed}
        </span>
      ) : null}
      {done ? (
        <span className="adm-hint" role="status">
          {done}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- pick */

/**
 * The weighed fact of one line: how much actually left the shelf. The
 * server validates the envelope again, so a wrong number is refused there.
 */
export function PickForm({
  orderId,
  itemId,
  requested,
  unit,
}: {
  orderId: string;
  itemId: string;
  requested: string;
  unit: string;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("");
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setFailed(null);
    const value = quantity.trim();
    try {
      if (boundedThousandths(value) <= 0) throw new Error("Non-positive quantity");
    } catch {
      setFailed("اكتب كمية أكبر من صفر وحتى 999999999.999، وبحد أقصى 3 أرقام عشرية.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      await apiRequest(`/api/admin/orders/${orderId}/items/${itemId}/pick`, {
        method: "POST",
        body: { actualQuantity: value },
      });
      setQuantity("");
      router.refresh();
    } catch (error) {
      setFailed(adminErrorMessage(error, "مقدرناش نسجّل الكمية. حاول تاني."));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form className="adm-form" onSubmit={(event) => void submit(event)}>
      <AdminField
        label={`الكمية اللي اتجهّزت (المطلوب ${requested} ${unit})`}
        hint="الكمية اللي خرجت من المخزن فعليًا. المتجر بيحسب فرق التكلفة على أساسها."
        error={failed ?? undefined}
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        )}
      </AdminField>
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          سجّل الكمية اللي اتجهّزت
        </AdminButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- propose */

/**
 * Offer one or more substitutes for a line the store cannot fill (owner
 * decision update, 2026-11-19 — MULTI-ALTERNATIVE: the store sends one
 * proposal with N alternatives; the customer picks ONE).
 */
export function ProposeForm({
  orderId,
  lines,
}: {
  orderId: string;
  lines: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [markUnavailable, setMarkUnavailable] = useState(true);
  const [alts, setAlts] = useState<Array<{ variantId: string; quantity: string; reason: string }>>([
    { variantId: "", quantity: "", reason: "" },
  ]);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function addAlt() {
    if (alts.length >= 3) return;
    setAlts((prev) => [...prev, { variantId: "", quantity: "", reason: "" }]);
  }
  function removeAlt(idx: number) {
    if (alts.length === 1) return;
    setAlts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setFailed(null);
    const complete = alts.filter((a) => a.variantId.trim() !== "");
    if (!lineId || complete.length === 0 || complete.some((a) => a.quantity.trim() === "")) {
      setFailed("اختر صنفًا بديلًا وكمية لكل بديل (ما يزيد 3 بدائل).");
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      await apiRequest(`/api/admin/orders/${orderId}/items/${lineId}/replacements`, {
        method: "POST",
        body: {
          alternatives: complete.map((a) => ({
            replacementVariantId: a.variantId.trim(),
            replacementQuantity: a.quantity.trim(),
            reason: a.reason.trim() === "" ? null : a.reason.trim().slice(0, 2000),
          })),
          markUnavailable,
        },
      });
      setAlts([{ variantId: "", quantity: "", reason: "" }]);
      setMarkUnavailable(true);
      router.refresh();
    } catch (error) {
      setFailed(adminErrorMessage(error, "مقدرناش نبعت الاقتراح. حاول تاني."));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form className="adm-form" onSubmit={(event) => void submit(event)}>
      <AdminField label="الصنف اللي عايز تقترح له بديل" required>
        {({ inputId, describedBy }) => (
          <AdminSelect
            inputId={inputId}
            describedBy={describedBy}
            value={lineId}
            onChange={(event) => setLineId(event.target.value)}
          >
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.label}
              </option>
            ))}
          </AdminSelect>
        )}
      </AdminField>
      <p className="adm-label">البدائل (قصوى 3) — العميل يختار واحد فقط منها.</p>
      {alts.map((alt, idx) => (
        <div key={idx} className="adm-alt-row">
          <AdminField label={`رقم الشكل البيعي البديل #${idx + 1}`} required>
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={alt.variantId}
                onChange={(event) => setAlts(alts.map((a, i) => (i === idx ? { ...a, variantId: event.target.value } : a)))}
                dir="ltr"
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            )}
          </AdminField>
          <AdminField label={`كمية البديل #${idx + 1}`} required>
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={alt.quantity}
                onChange={(event) => setAlts(alts.map((a, i) => (i === idx ? { ...a, quantity: event.target.value } : a)))}
                inputMode="decimal"
                placeholder="0"
              />
            )}
          </AdminField>
          <AdminField label={`سبب البديل #${idx + 1}`}>
            {({ inputId, describedBy }) => (
              <AdminTextarea
                inputId={inputId}
                describedBy={describedBy}
                value={alt.reason}
                onChange={(event) => setAlts(alts.map((a, i) => (i === idx ? { ...a, reason: event.target.value } : a)))}
                maxLength={2000}
              />
            )}
          </AdminField>
          {alts.length > 1 ? (
            <button type="button" className="adm-btn adm-btn--secondary" onClick={() => removeAlt(idx)}>
              حذف
            </button>
          ) : null}
        </div>
      ))}
      <div>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={addAlt} disabled={alts.length >= 3}>
          أضف بديلًا
        </button>
      </div>
      <div className="adm-checkbox-row">
        <label className="adm-checkbox-label">
          <input
            type="checkbox"
            checked={markUnavailable}
            onChange={(event) => setMarkUnavailable(event.target.checked)}
          />
          ضع الصنف بحالة &laquo;غير متوفر&raquo; (PENDING→UNAVAILABLE)
        </label>
      </div>
      {failed ? (
        <p className="adm-error" role="alert">
          {failed}
        </p>
      ) : null}
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          ابعت اقتراح البدائل
        </AdminButton>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- copy */

/** The phone stays readable and copyable without becoming the headline. */
export function CopyTextButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <AdminButton
      variant="secondary"
      size="sm"
      onClick={() => void copy()}
      aria-label={copied ? `تم النسخ: ${label}` : `انسخ ${label}`}
      className="adm-action-gap"
    >
      {copied ? "تم النسخ" : "انسخ"}
    </AdminButton>
  );
}
