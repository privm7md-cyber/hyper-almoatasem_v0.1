"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "@/app/actions/auth";

const initialState: LoginActionState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="text-sm font-medium">
          البريد الإلكتروني
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">
          كلمة المرور
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? "جارٍ الدخول…" : "دخول"}
      </button>
    </form>
  );
}
