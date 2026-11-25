// CUSTOMER REGISTER ISLAND ("use client").
//
// Staff-assisted guest → registered upgrade
// (POST /api/admin/customers/[id]/register). The server owns the policy, the
// uniqueness check and the audit row; this island only collects the secret
// and shows the outcome in Arabic.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton, AdminField, AdminInput } from "@/components/admin/ui/controls";

/** The store's password floor — the server refuses anything shorter. */
const PASSWORD_MIN = 12;

export function CustomerRegisterForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);

    if (password.length < PASSWORD_MIN) {
      setError(`كلمة السر لازم تكون ${PASSWORD_MIN} حرف على الأقل.`);
      return;
    }

    setPending(true);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/register`, {
        method: "POST",
        body: { password },
      });
      setSaved(true);
      setPassword("");
      router.refresh();
    } catch (failure) {
      setError(adminErrorMessage(failure, "تعذّر تسجيل العميل. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adm-form" noValidate onSubmit={(event) => void submit(event)}>
      <AdminField
        label="كلمة مرور العميل"
        required
        hint={`العميل هيستخدمها مع تليفونه عشان يدخل على المتجر. ${PASSWORD_MIN} حرف على الأقل.`}
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            maxLength={128}
          />
        )}
      </AdminField>

      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="adm-note adm-note--accent">العميل اتسجل والقدر يدخل على المتجر.</p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          تسجيل العميل
        </AdminButton>
      </div>
    </form>
  );
}
