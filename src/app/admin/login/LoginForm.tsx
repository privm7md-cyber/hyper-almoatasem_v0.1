"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "@/app/actions/auth";
import { AdminButton, AdminField, AdminInput } from "@/components/admin/ui/controls";

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="adm-form adm-form--grid" noValidate>
      <AdminField label="البريد الإلكتروني" required hint="نفس البريد اللي بتدخل بيه للمتجر.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            name="email"
            type="email"
            autoComplete="username"
            dir="ltr"
            required
          />
        )}
      </AdminField>
      <AdminField label="كلمة المرور" required>
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            name="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
          />
        )}
      </AdminField>
      {state?.error ? (
        <p role="alert" className="adm-error">
          {state.error}
        </p>
      ) : null}
      <AdminButton type="submit" variant="primary" loading={pending}>
        {pending ? "جاري الدخول…" : "دخول للوحة"}
      </AdminButton>
    </form>
  );
}
