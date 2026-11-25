// FE-4 guest-cart bearer storage (client-only).
// Locked posture (FP-11.4 §4.2/§17): raw 64-hex token persisted to operate further;
// header-only transport, never URL/logs. This is the CART bearer only — never the
// per-order credential (FP03-G1 forbids order secrets here) and never any session.

"use client";

const KEY = "hyper_cart_guest_token";
const GUEST_CART_COOKIE = "hyper_guest_cart";

export function readGuestCartToken(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    const valid = v !== null && /^[0-9a-f]{64}$/i.test(v) ? v : null;
    if (valid && typeof document !== "undefined" && !document.cookie.includes(GUEST_CART_COOKIE)) {
      document.cookie = `${GUEST_CART_COOKIE}=1; path=/; SameSite=Lax`;
    }
    return valid;
  } catch {
    return null;
  }
}

export function writeGuestCartToken(raw: string): void {
  if (!/^[0-9a-f]{64}$/i.test(raw)) return;
  try {
    window.localStorage.setItem(KEY, raw);
    if (typeof document !== "undefined") {
      document.cookie = `${GUEST_CART_COOKIE}=1; path=/; SameSite=Lax`;
    }
  } catch {
    // Storage unavailable (private mode etc.): caller falls back to mint-per-need.
  }
}

export function clearGuestCartToken(): void {
  try {
    window.localStorage.removeItem(KEY);
    if (typeof document !== "undefined") {
      document.cookie = `${GUEST_CART_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    }
  } catch {
    // Intentionally silent.
  }
}
