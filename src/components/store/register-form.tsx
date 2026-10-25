// FE-6 registration island ("use client"): phone + name + password → register endpoint.
// 201 sets the session cookie (auto-login per contract); 409 duplicate → login guidance.
// Password policy (12..128) is enforced server-side; the form only requires non-empty.
// NAV-02: after success, return to the user's internal destination (?next=…) when safe.

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { returnToQuery, safeReturnTo } from "@/lib/frontend/return-to";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function RegisterForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (phone.trim() === "" || firstName.trim() === "" || password === "") {
      setError("أكمل الحقول المطلوبة: الهاتف والاسم وكلمة المرور.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/store/customers/register", {
        method: "POST",
        body: { phone: phone.trim(), firstName: firstName.trim(), password },
      });
      const next = safeReturnTo(new URLSearchParams(window.location.search).get("next"));
      router.push(next);
      router.refresh();
    } catch (err) {
      if (err instanceof AppError && err.code === "CONFLICT") {
        setError("هذا الرقم مسجل بالفعل — سجّل الدخول.");
      } else if (err instanceof AppError && err.code === "RATE_LIMITED") {
        setError("محاولات كثيرة — انتظر قليلًا ثم حاول مجددًا.");
      } else {
        setError(err instanceof AppError ? err.message : "تعذّر إنشاء الحساب.");
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[420px] gap-3">
      <Field label="رقم الهاتف">
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
      <Field label="الاسم الأول">
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        )}
      </Field>
      <Field label="كلمة المرور" hint="12 حرفًا على الأقل حسب سياسة الخادم">
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
          {error.includes("مسجل") ? (
            <>
              {" "}
              <Link
                href={`/login${returnToQuery(new URLSearchParams(window.location.search).get("next"))}`}
                className="font-semibold text-brand"
              >
                إلى الدخول
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        إنشاء الحساب
      </Button>
    </form>
  );
}
