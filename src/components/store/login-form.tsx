// FE-6 login form island ("use client"): phone + password → session endpoint.
// Session cookie is HttpOnly (backend sets it); nothing sensitive is stored client-side.
// Generic failure message (never distinguishes unknown phone / wrong password / lockout).

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (phone.trim() === "" || password === "") {
      setError("أدخل رقم الهاتف وكلمة المرور.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/store/customers/session", {
        method: "POST",
        body: { phone: phone.trim(), password },
      });
      router.push("/account");
      router.refresh();
    } catch (err) {
      setError(err instanceof AppError ? "بيانات الدخول غير صحيحة." : "تعذّر تسجيل الدخول.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[420px] gap-3" noValidate={false}>
      <Field label="رقم الهاتف" error={undefined}>
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            inputMode="tel"
            autoComplete="username"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      <Field label="كلمة المرور" error={undefined}>
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
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
