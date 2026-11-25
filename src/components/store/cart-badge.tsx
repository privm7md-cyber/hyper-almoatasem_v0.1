// Live cart item count badge island ("use client", GAP-03 remediation).
// Maintains a synchronized in-memory + CustomEvent count updated whenever any
// cart island (CardBuy, PurchasePanel, CartView, CheckoutFlow) receives a
// server cart payload or completes checkout. Never invents math and never
// pollutes localStorage.

"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiRequest } from "@/lib/frontend/api-client";
import { MOTION_DURATIONS_MS } from "@/lib/motion-tokens";
import { readGuestCartToken } from "./guest-cart-token";

export const CART_UPDATED_EVENT = "hyper-cart-updated";

const CACHE_KEY = "hyper_cart_badge_cache";

function readCachedCartCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCachedCartCount(count: number): void {
  if (typeof window === "undefined") return;
  try {
    if (count > 0) window.sessionStorage.setItem(CACHE_KEY, String(count));
    else window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Session storage unavailable
  }
}

let currentCartLineCount = 0;
const listeners = new Set<() => void>();

function emitCartChange(): void {
  for (const listener of listeners) listener();
}

export function notifyCartCount(count: number): void {
  const safe = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
  currentCartLineCount = safe;
  writeCachedCartCount(safe);
  emitCartChange();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<number>(CART_UPDATED_EVENT, { detail: safe }));
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const bc = new BroadcastChannel("hyper_cart_channel");
        bc.postMessage({ type: "COUNT", count: safe });
        bc.close();
      } catch {
        // BroadcastChannel unavailable
      }
    }
  }
}

export function getCartLineCount(): number {
  return currentCartLineCount || readCachedCartCount();
}

function subscribeCartCount(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }
  function onUpdate(event: Event) {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === "number") {
      currentCartLineCount = detail;
    }
    listener();
  }
  window.addEventListener(CART_UPDATED_EVENT, onUpdate);
  let bc: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      bc = new BroadcastChannel("hyper_cart_channel");
      bc.onmessage = (msg) => {
        if (msg.data?.type === "COUNT" && typeof msg.data.count === "number") {
          currentCartLineCount = msg.data.count;
          writeCachedCartCount(msg.data.count);
          listener();
        }
      };
    } catch {
      // BroadcastChannel unavailable
    }
  }
  return () => {
    listeners.delete(listener);
    window.removeEventListener(CART_UPDATED_EVENT, onUpdate);
    if (bc) bc.close();
  };
}

function getServerCartCount(): number {
  return 0;
}

export function CartBadge() {
  const count = useSyncExternalStore(subscribeCartCount, getCartLineCount, getServerCartCount);
  const prevCountRef = useRef<number | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (prevCountRef.current === null) {
      prevCountRef.current = count;
      return;
    }
    if (prevCountRef.current === count) return;
    prevCountRef.current = count;
    const el = badgeRef.current;
    if (!el) return;
    if (count <= 0) {
      el.removeAttribute("data-cart-pulse");
      return;
    }
    // Synchronize ephemeral pulse attribute directly on the DOM node so
    // confirmed count updates trigger CSS keyframe motion without cascading renders.
    el.removeAttribute("data-cart-pulse");
    void el.offsetWidth;
    el.setAttribute("data-cart-pulse", "true");
    const timer = window.setTimeout(() => {
      badgeRef.current?.removeAttribute("data-cart-pulse");
    }, MOTION_DURATIONS_MS.short);
    return () => window.clearTimeout(timer);
  }, [count]);

  useEffect(() => {
    // Best-effort background sync when identity exists (guest token or customer session).
    // Defers network fetch until after initial paint so it never competes with LCP.
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const token = readGuestCartToken();
    const hasCustomerCookie =
      typeof document !== "undefined" &&
      (document.cookie.includes("__Host-customer-session") ||
        document.cookie.includes("hyper-customer-session-dev"));

    if ((token || hasCustomerCookie) && typeof globalThis.fetch === "function") {
      cancelTimer = setTimeout(() => {
        void apiRequest<{ cart?: { lines?: unknown[] } }>("/api/store/cart", {
          headers: token ? { "x-guest-token": token } : {},
        })
          .then((res) => {
            const lines = res?.data?.cart?.lines;
            if (Array.isArray(lines)) {
              notifyCartCount(lines.length);
            }
          })
          .catch((err) => {
            if (err?.code === "UNAUTHENTICATED" || err?.code === "NOT_FOUND" || err?.code === "VALIDATION") {
              notifyCartCount(0);
            }
          });
      }, 1200);
    }

    return () => {
      if (cancelTimer) clearTimeout(cancelTimer);
    };
  }, []);

  if (count <= 0) {
    return (
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        السلة فارغة
      </span>
    );
  }

  return (
    <span
      ref={badgeRef}
      data-testid="cart-badge"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${count} في السلة`}
      className="pointer-events-none absolute -top-1.5 -end-1.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-brand px-1 text-[10px] font-bold leading-none text-white shadow-xs transition-[transform,background-color] duration-[var(--motion-short,200ms)]"
    >
      {count}
    </span>
  );
}
