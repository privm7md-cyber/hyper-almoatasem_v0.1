// Customer self-service password change island ("use client", GAP-02 remediation).
// Calls PATCH /api/store/customers/password { currentPassword, newPassword }.
// Per backend contract, changing password revokes all customer sessions so the
// customer is guided to sign in again with their new password.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function PasswordChangeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(null);
    if (currentPassword === "" || newPassword === "") {
      setError("أدخل كلمة المرور الحالية وكلمة المرور الجديدة.");
      return;
    }
    if (newPassword.length < 12) {
      setError("كلمة المرور الجديدة يجب أن تكون 12 حرفًا على الأقل.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/store/customers/password", {
        method: "PATCH",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("تم تغيير كلمة المرور بنجاح — يرجى تسجيل الدخول مجددًا.");
      router.push("/login");
      router.refresh();
    } catch (err) {
      if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
        setError("كلمة المرور الحالية غير صحيحة أو انتهت الجلسة.");
      } else {
        setError(err instanceof AppError ? err.message : "تعذّر تغيير كلمة المرور.");
      }
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          تغيير كلمة المرور
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid max-w-[420px] gap-3 rounded-card border border-line bg-white p-4"
    >
      <h2 className="text-base font-bold">تغيير كلمة المرور</h2>
      <Field label="كلمة المرور الحالية">
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label="كلمة المرور الجديدة" hint="12 حرفًا على الأقل">
        {({ inputId, describedBy }) => (
          <TextInput
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success-ink">
          {success}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          حفظ كلمة المرور
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          تراجع
        </Button>
      </div>
    </form>
  );
}
