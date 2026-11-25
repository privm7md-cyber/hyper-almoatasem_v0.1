// USER CREATE ISLAND ("use client").
//
// Adds a team account: name, email and an optional phone. The account is
// created without a secret — the password is set from the account's own page,
// so it is never typed here and never crosses this form.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminField, AdminInput } from "@/components/admin/ui/controls";

export function UserCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (trimmedName === "") {
      setError("اسم الحساب مطلوب.");
      return;
    }
    if (!trimmedEmail.includes("@")) {
      setError("البريد الإلكتروني شكله مش مظبوط.");
      return;
    }
    if (trimmedPhone !== "" && !/^[0-9]{8,15}$/.test(trimmedPhone)) {
      setError("التليفون لازم يكون من 8 لـ 15 رقم.");
      return;
    }

    setPending(true);
    try {
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: {
          name: trimmedName,
          email: trimmedEmail,
          ...(trimmedPhone === "" ? {} : { phone: trimmedPhone }),
        },
      });
      setSaved(true);
      setName("");
      setEmail("");
      setPhone("");
      router.refresh();
    } catch (failure) {
      setError(
        (failure as { code?: string } | null)?.code === "CONFLICT"
          ? "البريد الإلكتروني ده مستخدم في حساب تاني. جرّب بريد تاني."
          : adminErrorMessage(failure, "تعذّر إضافة الحساب. جرّب تاني."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adm-form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="adm-form-grid">
        <AdminField label="اسم الحساب" required>
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          )}
        </AdminField>
        <AdminField label="البريد الإلكتروني" required hint="ده اللي الحساب بيسجّل بيه الدخول.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              type="email"
              dir="ltr"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={160}
              autoComplete="off"
            />
          )}
        </AdminField>
      </div>

      <AdminField label="التليفون" optional hint="من 8 لـ 15 رقم، لو الحساب ليه تليفون في المتجر.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            type="tel"
            inputMode="numeric"
            dir="ltr"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={15}
            autoComplete="off"
          />
        )}
      </AdminField>

      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="adm-note adm-note--accent">الحساب اتضاف. افتح صفحته عشان تحدّد كلمة السر.</p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          إضافة الحساب
        </AdminButton>
      </div>
    </form>
  );
}
