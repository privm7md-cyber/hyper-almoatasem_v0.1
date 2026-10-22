// Phase-10 admin permission gate (server component).
//
// Purpose: the admin UI renders write controls that the SERVER enforces with a
// specific permission key. Rendering a control an operator cannot use produces
// a guaranteed 403 — a dead action. This gate renders the control only when
// the session snapshot actually holds the key the server checks, and otherwise
// states the required key in words (never colour-only, never a silent blank).
//
// Visibility is UX ONLY. `src/lib/auth/rbac.ts` re-checks every permission on
// every request; hiding a control never grants and never removes authority.
// The keys named here MUST match the guard literals in `src/app/api/admin/**`.

import React from "react";

export function PermissionGate({
  permissions,
  required,
  children,
  action,
}: {
  /** Effective permission keys of the signed-in admin (session snapshot). */
  permissions: readonly string[];
  /** Exact permission key enforced by the server route behind `children`. */
  required: string;
  children: React.ReactNode;
  /** Short Arabic name of the action, used in the refusal note. */
  action?: string;
}) {
  if (permissions.includes(required)) return <>{children}</>;
  return (
    <p className="text-sm text-secondary">
      لا تملك صلاحية{" "}
      <span dir="ltr" className="font-mono">
        {required}
      </span>
      {action ? ` — ${action} غير متاح لحسابك.` : " — هذا الإجراء غير متاح لحسابك."}
    </p>
  );
}
