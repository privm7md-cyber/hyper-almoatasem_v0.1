// FE-11.2 approved card contract (FP11-D17, AC-P3 / Phase-02 D01+D14), EXTENDED by
// Phase 07 (P07-T01 §6): a PIECE card carries its own add-to-cart island, now
// BOUND to the shared cart-lines store —
//   • quantity is always ONE pack from the card (weights are NOT sold from cards;
//     PDP owns weight choice);
//   • the variant is resolved from the product's variant list ON CLICK (list payloads
//     do not carry variant ids — no invented data);
//   • the add is hidden for OOS cards (the availability chip + PDP own the disabled add);
//   • the displayed quantity is the server's confirmed text: the extended island reads
//     the shared cart-lines store (one deduped GET probing shared by all cards — no
//     per-card fan-out), adds via POST `quantity:"1"` (re-add AGGREGATES per contract),
//     steps IN-CART quantity with PATCH absolute set, and reaches zero through
//     DELETE (the contract rejects a 0 PATCH);
//   • duplicate taps are rejected by a REAL per-line guard in the store logic;
//   • a late response can never overwrite a newer confirmed snapshot (send-order
//     sequencing in the store) and a discarded response schedules a reconcile probe.
// States per the approved map: idle (not in cart) / adding pending / in-cart /
// updating pending / removing pending / operation failed / validation error, with
// the card-level availability overlays (oos → island not rendered; unknown → island
// rendered: the server is the authority) owned by the card's availability chip.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import {
  useCartLinesStore,
  useProductCartSlice,
  type OpResult,
} from "@/lib/frontend/cart-lines-store";
import { readGuestCartToken } from "./guest-cart-token";

interface VariantRow {
  id: string;
}

interface Confirmed {
  variantName: string;
  quantity: string;
  lineTotal: string | null;
}

interface Note {
  text: string;
  alert: boolean;
  link: boolean;
}

/** Integer quantities render as integers; anything else keeps the server's
 * exact text (the card never re-rounds a server-reported quantity). */
function displayQuantity(quantity: string): string {
  const n = Number(quantity);
  return Number.isInteger(n) ? String(n) : quantity;
}

export function CardBuy({ productId, slug }: { productId: string; slug?: string }) {
  const { line, lineUniqueForProduct, inCartAmbiguous, op } = useProductCartSlice(productId);
  const [phase, setPhase] = useState<"idle" | "pending" | "failed">("idle");
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const addInflightRef = useRef(false);
  const pdpHref = slug ? `/p/${productId}/${encodeURIComponent(slug)}` : `/p/${productId}`;

  // Shared mount probe: only if the visitor has a guest token or session cookie.
  // Fresh visitors without active identity do not send an unnecessary probe.
  useEffect(() => {
    const token = readGuestCartToken();
    const hasCustomerCookie =
      typeof document !== "undefined" &&
      (document.cookie.includes("__Host-customer-session") ||
        document.cookie.includes("hyper-customer-session-dev"));

    if (token || hasCustomerCookie) {
      void useCartLinesStore.getState().sync();
    }
  }, []);

  // The sticky confirm note follows the store (external system) — subscription
  // callback, never a synchronous setState in the effect body: when the line
  // leaves the confirmed space (removed anywhere in the app), the "في السلة"
  // note must go with it — never a stale claim.
  useEffect(() => {
    return useCartLinesStore.subscribe((state) => {
      const matches = Object.values(state.lines).some((l) => l.productId === productId);
      if (!matches) {
        setConfirmed(null);
      }
    });
  }, [productId]);

  async function add() {
    if (addInflightRef.current || phase === "pending" || op !== null) return;
    addInflightRef.current = true;
    setPhase("pending");
    setNote(null);
    try {
      // 1) Resolve the variant at click time (the card payload has no variant id).
      let variantsRes: { data: VariantRow[] };
      try {
        variantsRes = await apiRequest<VariantRow[]>(
          `/api/store/catalog/products/${productId}/variants`,
        );
      } catch {
        // P09 §9: a failed READ is not "no variants" — never shade a lookup
        // failure as catalog absence (the two have different remedies).
        setPhase("failed");
        setNote({ text: "تعذّر جلب اختيارات المنتج — حاول مجددًا.", alert: true, link: false });
        return;
      }
      const variantId =
        Array.isArray(variantsRes.data) && variantsRes.data.length > 0
          ? variantsRes.data[0]?.id
          : null;
      if (typeof variantId !== "string") {
        setPhase("failed");
        setNote({ text: "لا توجد اختيارات متاحة — راجع صفحة التفاصيل.", alert: true, link: true });
        return;
      }
      // 2) Add one pack through the store (identity ladder + single flight +
      //    stale-response rule live in the store; re-add aggregates per contract).
      const res = await useCartLinesStore.getState().addPack(variantId);
      if (!res.ok) {
        if ("duplicatedRejected" in res) {
          setPhase("idle");
          return;
        }
        if (res.uncertain) {
          // P09 §6: the outcome at the server is unknown — no success, no fake
          // failure; the store schedules a reconcile probe (fresh GET, no resend).
          setPhase("idle");
          setNote({
            text: "تعذّر التأكد من نتيجة الإضافة — جارٍ التحقق من حالة السلة.",
            alert: true,
            link: false,
          });
          return;
        }
        throw res.error ?? new AppError("INTERNAL", "تعذّر الإضافة.");
      }
      // 3) Indicator ONLY from the confirmed response (never optimistic math).
      const serveLine = res.line;
      setConfirmed({
        variantName: serveLine?.variantName ?? "",
        quantity: displayQuantity(serveLine?.quantity ?? "1"),
        lineTotal: serveLine?.lineTotal ?? null,
      });
      setPhase("idle");
    } catch (error) {
      setPhase("failed");
      setNote({
        text:
          error instanceof AppError && error.code === "UNAUTHENTICATED"
            ? "انتهت الجلسة — سجّل الدخول ثم حاول مجددًا."
            : "تعذّر الإضافة — راجع صفحة التفاصيل وحاول مجددًا.",
        alert: true,
        link: true,
      });
    } finally {
      addInflightRef.current = false;
    }
  }

  function increase() {
    if (line === null || op !== null) return;
    void stepOp(() => useCartLinesStore.getState().addPack(line.variantId), "increase");
  }

  function decrease() {
    if (line === null || op !== null) return;
    const n = Number(line.quantity);
    if (Number.isInteger(n) && n <= 1) {
      // Contract: quantity 0 is rejected on PATCH — removal is DELETE only.
      void stepOp(() => useCartLinesStore.getState().removeLine(line.variantId), "remove");
      return;
    }
    if (!Number.isInteger(n)) {
      // A non-integer PIECE quantity is unexpected server-side; the card never
      // re-rounds it — quantity edits stay in the cart page/PDP (full inputs).
      setNote({
        text: "عدّل هذه الكمية من صفحة السلة أو تفاصيل المنتج.",
        alert: false,
        link: false,
      });
      return;
    }
    void stepOp(
      () => useCartLinesStore.getState().setQuantity(line.variantId, String(n - 1)),
      "decrease",
    );
  }

  async function stepOp(run: () => Promise<OpResult>, kind: "increase" | "decrease" | "remove") {
    setNote(null);
    const res = await run();
    if (!res.ok) {
      if ("duplicatedRejected" in res) return;
      if (res.uncertain) {
        // P09 §6: outcome unknown — no success claim, no fake failure; the store
        // schedules a reconcile probe (fresh GET, no write resend).
        setNote({
          text: "تعذّر التأكد من نتيجة العملية — جارٍ التحقق من حالة السلة.",
          alert: true,
          link: false,
        });
        return;
      }
      if (res.error?.code === "NOT_FOUND") {
        // Verified rejection (e.g., the line is already gone): the store
        // reconciles from a fresh GET — never a blind resend.
        setNote({
          text: "السطر غير موجود — تتم مزامنة الحالة تلقائيًا من الخادم.",
          alert: false,
          link: false,
        });
        return;
      }
      setNote({
        text:
          kind === "remove"
            ? "تعذّر إزالة السطر — جرّب مجددًا."
            : kind === "increase"
              ? "تعذّرت زيادة الكمية — جرّب مجددًا."
              : "تعذّر تحديث الكمية — جرّب مجددًا.",
        alert: true,
        link: false,
      });
      return;
    }
    if (kind === "remove") {
      // Confirmed empty-cart response: the line left the store; back to add state.
      setConfirmed(null);
      setNote({ text: "أُزيل من السلة.", alert: false, link: false });
      return;
    }
    const serverLine = res.line;
    if (serverLine !== null) {
      setConfirmed({
        variantName: serverLine.variantName,
        quantity: displayQuantity(serverLine.quantity),
        lineTotal: serverLine.lineTotal,
      });
    }
  }

  // Narrowed once: the stepper slice exists only when exactly one line matches.
  const inCartLine = lineUniqueForProduct ? line : null;
  const busy = op !== null;

  return (
    <div className="grid gap-1">
      {inCartLine !== null ? (
        // Stable two-row compact stepper across the op lifecycle: prevents card
        // horizontal clipping on 320px–390px 2-column grids and 768px 4-column
        // grids while keeping >=44x44 touch targets and live status feedback.
        <div className="grid grid-cols-2 gap-1.5" aria-busy={busy || undefined} data-state={busy ? "busy" : "idle"}>
          <span
            aria-live="polite"
            className="col-span-2 grid min-h-[34px] place-items-center rounded-control border border-line bg-purple-surface/40 px-2 text-center text-xs font-bold text-ink transition-colors duration-[var(--motion-fast,170ms)]"
          >
            {busy ? (
              <span className="text-xs font-semibold text-secondary">
                {op === "removing"
                  ? "جارٍ الإزالة…"
                  : op === "adding"
                    ? "جارٍ الإضافة…"
                    : "جارٍ التحديث…"}
              </span>
            ) : (
              <span>
                في السلة: <bdi>{displayQuantity(inCartLine.quantity)}</bdi>
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={decrease}
            disabled={busy}
            aria-label="تقليل الكمية"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line-strong bg-white text-lg font-bold text-ink transition-[transform,colors,border-color,background-color] duration-[var(--motion-fast,170ms)] hover:border-brand hover:bg-purple-surface active:scale-[0.96] disabled:opacity-55 disabled:active:scale-100"
          >
            −
          </button>
          <button
            type="button"
            onClick={increase}
            disabled={busy}
            aria-label="زيادة الكمية"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-line-strong bg-white text-lg font-bold text-ink transition-[transform,colors,border-color,background-color] duration-[var(--motion-fast,170ms)] hover:border-brand hover:bg-purple-surface active:scale-[0.96] disabled:opacity-55 disabled:active:scale-100"
          >
            +
          </button>
        </div>
      ) : inCartAmbiguous ? (
        // ≥2 lines for one product: quantities are per-variant — any aggregate
        // number would be invented. A neutral, honest pointer to the cart/pdp.
        <p className="text-xs font-semibold text-secondary" role="status">
          في السلة — عدّل الكمية من{" "}
          <Link href={pdpHref} prefetch={false} className="font-semibold text-brand underline underline-offset-4">
            صفحة التفاصيل
          </Link>
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void add()}
          disabled={phase === "pending"}
          data-state={phase === "pending" ? "busy" : "idle"}
          className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-semibold text-ink transition-[transform,colors,border-color,background-color,opacity] duration-[var(--motion-fast,170ms)] hover:border-brand hover:bg-purple-surface active:scale-[0.98] disabled:opacity-55 disabled:active:scale-100"
        >
          {phase === "pending" ? "جارٍ الإضافة…" : "أضف إلى السلة"}
        </button>
      )}
      {confirmed && inCartLine === null && !inCartAmbiguous && phase !== "pending" ? (
        <p className="text-xs text-success-ink" role="status">
          في السلة: {confirmed.variantName} × <bdi>{confirmed.quantity}</bdi>
          {confirmed.lineTotal !== null && confirmed.lineTotal !== undefined
            ? ` — ${confirmed.lineTotal} ج.م`
            : ""}
        </p>
      ) : null}
      {note ? (
        <p
          role={note.alert ? "alert" : "status"}
          className={note.alert ? "text-xs text-error" : "text-xs text-secondary"}
        >
          {note.text}
          {note.alert ? (
            <>
              {" "}
              <Link href={pdpHref} prefetch={false} className="font-semibold text-brand underline underline-offset-4">
                صفحة التفاصيل
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
