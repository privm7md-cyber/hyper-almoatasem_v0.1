// FE-11.2 approved card contract (FP11-D17, AC-P3 / Phase-02 D01+D14): a PIECE card
// carries its own add-to-cart island —
//   • quantity is always ONE pack (weights are NOT sold from cards; PDP owns weight choice);
//   • the variant is resolved from the product's variant list ON CLICK (list payloads
//     do not carry variant ids — no invented data);
//   • add is hidden for OOS cards (the availability chip + PDP own the disabled add).
// States exactly as approved: pending → confirmed (indicator derived from the
// CONFIRMED cart response: the line's quantity/total, not optimistic math) / failure.
"use client";

import { useState } from "react";
import Link from "next/link";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { readGuestCartToken, writeGuestCartToken } from "@/components/store/guest-cart-token";

interface CartLine {
  productVariantId: string;
  variantName: string;
  quantity: string;
  lineTotal: string | null;
}

interface VariantRow {
  id: string;
}

interface Confirmed {
  variantName: string;
  quantity: string;
  lineTotal: string | null;
}

type Phase = "idle" | "pending" | "confirmed" | "failed";

async function mintGuestToken(): Promise<string | null> {
  try {
    const res = await apiRequest<{ cart: unknown; guestToken?: string }>("/api/store/cart", { method: "POST" });
    const token = typeof res.data.guestToken === "string" ? res.data.guestToken : null;
    if (token) writeGuestCartToken(token);
    return token;
  } catch {
    return null;
  }
}

export function CardBuy({ productId }: { productId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);

  async function add() {
    if (phase === "pending") return;
    setPhase("pending");
    setNote(null);
    try {
      // 1) Resolve the variant at click time (the card payload has no variant id).
      const variantsRes = await apiRequest<VariantRow[]>(
        `/api/store/catalog/products/${productId}/variants`,
      );
      const variantId =
        Array.isArray(variantsRes.data) && variantsRes.data.length > 0
          ? variantsRes.data[0]?.id
          : null;
      if (typeof variantId !== "string") {
        setPhase("failed");
        setNote("لا توجد اختيارات متاحة — راجع صفحة التفاصيل.");
        return;
      }
      // 2) Add one pack with the mint-once-then-retry rule (same as the PDP island).
      const attempt = async (token: string | null) =>
        apiRequest<{ cart: { lines: CartLine[] } }>("/api/store/cart/items", {
          method: "POST",
          body: { productVariantId: variantId, quantity: "1" },
          ...(token ? { headers: { "x-guest-token": token } } : {}),
        });
      let res;
      try {
        res = await attempt(readGuestCartToken());
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "VALIDATION" &&
          /Exactly one of guest token/.test(error.message)
        ) {
          const minted = await mintGuestToken();
          if (!minted) throw error;
          res = await attempt(minted);
        } else {
          throw error;
        }
      }
      // 3) Indicator ONLY from the confirmed response (never optimistic math).
      const line = res.data?.cart?.lines?.find((l) => l.productVariantId === variantId) ?? null;
      setConfirmed({
        variantName: line?.variantName ?? "",
        quantity: line?.quantity ?? "1",
        lineTotal: line?.lineTotal ?? null,
      });
      setPhase("confirmed");
    } catch (error) {
      setPhase("failed");
      setNote(
        error instanceof AppError && error.code === "UNAUTHENTICATED"
          ? "انتهت الجلسة — سجّل الدخول ثم حاول مجددًا."
          : "تعذّر الإضافة — راجع صفحة التفاصيل وحاول مجددًا.",
      );
    }
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={() => void add()}
        disabled={phase === "pending"}
        className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-brand hover:bg-purple-surface disabled:opacity-55"
      >
        {phase === "pending" ? "جارٍ الإضافة…" : "أضف إلى السلة"}
      </button>
      {phase === "confirmed" ? (
        <p className="text-xs text-success-ink" role="status">
          في السلة: {confirmed?.variantName} × <bdi>{confirmed?.quantity}</bdi>
          {confirmed?.lineTotal !== null && confirmed?.lineTotal !== undefined
            ? ` — ${confirmed.lineTotal} ج.م`
            : ""}
        </p>
      ) : null}
      {phase === "failed" && note ? (
        <p className="text-xs text-error" role="alert">
          {note}{" "}
          <Link href={`/p/${productId}`} className="font-semibold text-brand underline underline-offset-4">
            صفحة التفاصيل
          </Link>
        </p>
      ) : null}
    </div>
  );
}
