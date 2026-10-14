// FE-4 guest-cart bearer storage (client-only).
// Locked posture (FP-11.4 §4.2/§17): raw 64-hex token persisted to operate further;
// header-only transport, never URL/logs. This is the CART bearer only — never the
// per-order credential (FP03-G1 forbids order secrets here) and never any session.

"use client";

const KEY = "hyper_cart_guest_token";

export function readGuestCartToken(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v !== null && /^[0-9a-f]{64}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeGuestCartToken(raw: string): void {
  if (!/^[0-9a-f]{64}$/i.test(raw)) return;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Storage unavailable (private mode etc.): caller falls back to mint-per-need.
  }
}

export function clearGuestCartToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Intentionally silent.
  }
}
