// Storefront — interactive replacement conversation area (owner decision
// update, 2026-11-19: chat-like multi-alternative replacements).
//
// Data (all server-authoritative):
//   GET  /api/store/orders/[id]/replacements           → toReplacement[]
//   POST /api/store/orders/[id]/replacements/[rid]/decide
//        approval/rejection decision plus an optional alternativeIndex
//   POST /api/store/orders/[id]/replacements/reject-all
//        { orderItemId, confirmed: true }
// Polling every 2s is acceptable (owner-approved); every write is
// server-gated (ownership / guest credential / state) — the UI renders only
// server results. Approve with alternativeIndex picks that alternative; the
// store materializes the new line; reject does not silently select another.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/frontend/api-client";
import { formatMoney, formatQuantity, unitLabel } from "@/lib/orders/display";
import type { ReplacementShape } from "@/lib/replacements/serialize";

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PROPOSED: "في انتظار رد العميل",
    CUSTOMER_APPROVED: "تم الاختيار — قيد التجهيز",
    CUSTOMER_REJECTED: "ملغي",
    AUTO_ACCEPTED: "مقبول تلقائيًا",
  };
  return labels[status] ?? status;
}

export function ReplacementConversation({
  orderId,
  replacements,
}: {
  orderId: string;
  replacements: ReplacementShape[];
}) {
  const [rows, setRows] = useState<ReplacementShape[]>(replacements);
  const [pollError, setPollError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiRequest<ReplacementShape[]>(`/api/store/orders/${orderId}/replacements`);
      setRows(res.data ?? []);
      setPollError(null);
    } catch {
      setPollError("تعذر تحديث حالة البدائل مؤقتًا. نعرض آخر حالة معروفة وسنحاول مجددًا.");
    }
  }, [orderId]);

  const hasOpenProposal = rows.some((row) => row.status === "PROPOSED");
  useEffect(() => {
    if (!hasOpenProposal) return;
    pollRef.current = setInterval(() => void refresh(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasOpenProposal, refresh]);

  const proposed = rows.filter((r) => r.status === "PROPOSED");
  if (proposed.length === 0 && !replacements.length) {
    return null;
  }

  async function decide(replacementId: string, index: number) {
    if (busyIds.has(replacementId)) return;
    setBusyIds((current) => new Set(current).add(replacementId));
    try {
      const approvalAction = "approve" as const;
      await apiRequest(`/api/store/orders/${orderId}/replacements/${replacementId}/decide`, {
        method: "POST",
        body: { action: approvalAction, alternativeIndex: index },
      });
      await refresh();
    } catch {
      /* server-gated; refresh to show authoritative state */
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(replacementId);
        return next;
      });
    }
  }

  async function rejectAll(orderItemId: string) {
    const busyKey = `reject:${orderItemId}`;
    if (busyIds.has(busyKey)) return;
    setBusyIds((current) => new Set(current).add(busyKey));
    try {
      await apiRequest(`/api/store/orders/${orderId}/replacements/reject-all?orderItemId=${encodeURIComponent(orderItemId)}`, {
        method: "POST",
        body: { confirmed: true },
      });
      await refresh();
    } catch {
      /* keep polling; authoritative state comes from the server */
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(busyKey);
        return next;
      });
    }
  }

  return (
    <section aria-label="حوار البدائل" className="rounded-card border border-line bg-white p-5 shadow-xs">
      <h2 className="font-bold text-brand-deep">الحوار: البدائل المقترحة ({proposed.length})</h2>
      {pollError ? <p className="mt-2 text-sm text-error" role="status">{pollError}</p> : null}
      <ol className="mt-3 grid gap-4">
        {rows.map((rep) => {
          const hasApproved = rows.some((r) => r.original.orderItemId === rep.original.orderItemId && r.status === "CUSTOMER_APPROVED");
          return (
            <li key={rep.id} className="rounded-control border border-line/80 bg-purple-surface/25 p-4">
              <p className="font-semibold">
                الأصيل: {rep.original.productName} — {rep.original.variantName}
              </p>
              <p className="text-sm">
                كمية الصنف المطلوبة: <bdi>{formatQuantity(rep.original.requestedQuantity, "PIECE")}</bdi>{" "}
                {unitLabel(rep.original.unitSnapshot ?? "")}              </p>
              <p className="text-xs text-secondary">{rep.reason ?? ""}</p>
              {rep.status !== "PROPOSED" ? (
                <p className="mt-2 text-sm font-semibold">{statusLabel(rep.status)}</p>
              ) : (
                <div className="mt-3 grid gap-3">
                  {rep.alternatives.map((alt, i) => (
                    <div key={alt.variantId} className="rounded-control border border-line bg-white p-3 text-sm">
                      <p>
                        البديل {i + 1}: <bdi>{alt.productName}</bdi> — {alt.variantName}
                        {alt.price ? ` · ${formatMoney(alt.price)}` : ""}
                        {alt.priceDifference && Number(alt.priceDifference) !== 0
                          ? ` · فرق السعر: ${formatMoney(alt.priceDifference)}`
                          : null}
                      </p>
                      <p className="text-secondary">
                        الكمية: <bdi>{alt.quantity}</bdi> {unitLabel(alt.unit)} — سعر الوحدة: <bdi>{alt.price ? formatMoney(alt.price) : ""}</bdi>
                        {alt.reason ? ` · ${alt.reason}` : null}
                      </p>
                      {alt.chosen ? (
                        <p className="font-semibold">تم الاختيار: بديل {i + 1}</p>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busyIds.has(rep.id)}
                          onClick={() => void decide(rep.id, i)}
                        >
                          اختيار البديل {i + 1}
                        </Button>
                      )}
                    </div>
                  ))}
                  {hasApproved ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busyIds.has(`reject:${rep.original.orderItemId}`)}
                      onClick={() => void rejectAll(rep.original.orderItemId)}
                    >
                      رفض الجميع
                    </Button>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-secondary">
                <time dateTime={rep.createdAt}>{rep.createdAt}</time> — {statusLabel(rep.status)}
                {rep.decidedByType ? ` · القرار من: ${rep.decidedByType}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
