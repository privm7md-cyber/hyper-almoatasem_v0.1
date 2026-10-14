// FE-10F user forms island ("use client"): patch fields + password provisioning +
// role attach/detach. Every op re-verified server-side (users.manage); self-escalation
// and last-SUPER_ADMIN guards live in domain code, surfaced here as messages.

"use client";

import { useState } from "react";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

function Note({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-secondary">
      {text}
    </p>
  );
}

export function UserPatchForm({
  id,
  name,
  email,
  phone,
  isActive,
}: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
}) {
  const { notify } = useToast();
  const [nextName, setNextName] = useState(name);
  const [nextActive, setNextActive] = useState(isActive);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (nextName.trim() === "") {
      setNote("الاسم مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: { name: nextName.trim(), isActive: nextActive },
      });
      notify("success", "تم حفظ المستخدم.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <p className="text-sm text-secondary">
        <bdi>{email}</bdi>
        {phone ? (
          <>
            {" · "}<bdi>{phone}</bdi>
          </>
        ) : null}
      </p>
      <label className="grid gap-1 text-sm font-semibold">
        الاسم
        <input value={nextName} onChange={(e) => setNextName(e.target.value)} maxLength={120} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextActive} onChange={(e) => setNextActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        حفظ المستخدم
      </Button>
    </form>
  );
}

export function UserPasswordForm({ id }: { id: string }) {
  const { notify } = useToast();
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (password.length < 1) {
      setNote("أدخل كلمة المرور الجديدة.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/users/${id}/password`, { method: "POST", body: { password } });
      notify("success", "تم تعيين كلمة المرور.");
      setPassword("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر التعيين."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[420px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        كلمة مرور جديدة (تُدار وتُدقق على الخادم)
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending} variant="secondary">
        تعيين كلمة المرور
      </Button>
    </form>
  );
}

export function UserRolesManager({
  userId,
  assigned,
  allRoles,
}: {
  userId: string;
  assigned: string[];
  allRoles: { id: string; name: string }[];
}) {
  const { notify } = useToast();
  const [roleId, setRoleId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (pending || roleId === "") return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/users/${userId}/roles`, { method: "POST", body: { roleId } });
      notify("success", "تم إرفاق الدور.");
      setRoleId("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الإرفاق."));
    } finally {
      setPending(false);
    }
  }

  async function detach(rid: string) {
    setNote(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/roles/${rid}`, { method: "DELETE" });
      notify("success", "تم فصل الدور.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الفصل."));
    }
  }

  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-2">
        {assigned.length === 0 ? <li className="text-sm text-secondary">بلا أدوار.</li> : null}
        {assigned.map((name) => {
          const row = allRoles.find((r) => r.name === name);
          return (
            <li key={name} className="inline-flex items-center gap-2 rounded-badge border border-line bg-white px-3 py-1 text-sm">
              {name}
              {row ? (
                <button type="button" onClick={() => void detach(row.id)} aria-label={`فصل الدور ${name}`} className="min-h-[44px] min-w-[44px] font-bold text-error">
                  ×
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form onSubmit={(e) => void attach(e)} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-semibold">
          إرفاق دور
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            <option value="">— اختر —</option>
            {allRoles.filter((r) => !assigned.includes(r.name)).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" loading={pending}>
          إرفاق
        </Button>
      </form>
      <Note text={note} />
    </div>
  );
}
