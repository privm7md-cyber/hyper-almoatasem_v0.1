// FE-6 login form island ("use client"): phone + password → session endpoint.
// Session cookie is HttpOnly (backend sets it); nothing sensitive is stored client-side.
// Generic failure message (never distinguishes unknown phone / wrong password / lockout).
// NAV-02: after success, return to the user's internal destination (?next=…) when safe.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { safeReturnTo } from "@/lib/frontend/return-to";
import { clearGuestCartToken, readGuestCartToken } from "@/components/store/guest-cart-token";
import { notifyCartCount } from "@/components/store/cart-badge";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; password?: string }>({});
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const nextErrors: { phone?: string; password?: string } = {};
    if (phone.trim() === "") nextErrors.phone = "أدخل رقم الهاتف.";
    if (password === "") nextErrors.password = "أدخل كلمة المرور.";
    setFieldErrors(nextErrors);
    if (nextErrors.phone || nextErrors.password) {
      setError("أدخل رقم الهاتف وكلمة المرور.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/store/customers/session", {
        method: "POST",
        body: { phone: phone.trim(), password },
      });
      // GAP-01 remediation: automatically merge guest cart if a guest cart token exists.
      const guestToken = readGuestCartToken();
      if (guestToken) {
        try {
          const merged = await apiRequest<{ cart?: { lines?: unknown[] } }>("/api/store/cart/merge", {
            method: "POST",
            headers: { "x-guest-token": guestToken },
          });
          if (Array.isArray(merged?.data?.cart?.lines)) {
            notifyCartCount(merged.data.cart.lines.length);
          }
        } catch {
          // Non-fatal: login still succeeds even if guest cart was already empty/expired.
        } finally {
          clearGuestCartToken();
        }
      } else {
        // Sync customer's existing cart count to badge
        try {
          const res = await apiRequest<{ cart?: { lines?: unknown[] } }>("/api/store/cart");
          if (Array.isArray(res?.data?.cart?.lines)) {
            notifyCartCount(res.data.cart.lines.length);
          }
        } catch {
          notifyCartCount(0);
        }
      }
      const next = safeReturnTo(new URLSearchParams(window.location.search).get("next"));
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof AppError ? "بيانات الدخول غير صحيحة." : "تعذّر تسجيل الدخول.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[420px] gap-3" noValidate>
      <Field label="رقم الهاتف" required error={fieldErrors.phone}>
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            invalid={Boolean(fieldErrors.phone)}
            required
            inputMode="tel"
            autoComplete="username"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      <Field label="كلمة المرور" required error={fieldErrors.password}>
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            invalid={Boolean(fieldErrors.password)}
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        دخول
      </Button>
    </form>
  );
}
