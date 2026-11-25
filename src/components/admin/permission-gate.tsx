// ADMIN PERMISSION GATE (server component).
//
// The admin UI renders write controls that the SERVER enforces with a
// specific permission key. Rendering a control an operator cannot use
// produces a guaranteed 403 — a dead action. This gate renders the control
// only when the session snapshot actually holds the key the server checks,
// and otherwise states the missing capability IN WORDS (never a technical
// key, never colour-only, never a silent blank).
//
// Visibility is UX ONLY. `src/lib/auth/rbac.ts` re-checks every permission on
// every request; hiding a control never grants and never removes authority.

import React from "react";
import { Lock } from "lucide-react";
import { permissionLabel } from "@/lib/admin/terminology";

export function PermissionGate({
  permissions,
  required,
  alsoRequired = [],
  children,
  action,
}: {
  /** Effective permission keys of the signed-in admin (session snapshot). */
  permissions: readonly string[];
  /** Exact permission key enforced by the server route behind `children`. */
  required: string;
  /**
   * Additional keys the SAME server route requires (E-3 closure: the
   * delivery-zone write needs `settings.manage` AND `delivery.assign`).
   * Every missing key is named in the refusal note — never a technical key
   * alone, never colour-only, never a silent blank.
   */
  alsoRequired?: readonly string[];
  children: React.ReactNode;
  /** Short Arabic name of the action, used in the refusal note. */
  action?: string;
}) {
  const missing = [required, ...alsoRequired].filter((key) => !permissions.includes(key));
  if (missing.length === 0) return <>{children}</>;
  const labels = missing.map((key) => permissionLabel(key)).join(" + ");
  return (
    <div className="adm-note adm-note--info" role="note">
      <Lock size={16} className="adm-note-icon" aria-hidden="true" />
      <div>
        <strong>{action ? `${action} — غير متاح لحسابك.` : "الخطوة دي غير متاحة لحسابك."}</strong>{" "}
        محتاج صلاحية: {labels}. لو محتاج الخطوة دي في شغلك، كلّم مالك المتجر عشان يضيفها
        لحسابك.
      </div>
    </div>
  );
}
