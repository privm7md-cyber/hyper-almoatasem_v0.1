// FE-10F role forms island ("use client"): create + patch + delete + grant
// attach/detach. Guards (last-member removal, SUPER_ADMIN protection, delete
// constraints) enforced server-side; failures arrive as typed API errors.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export function RoleCreateForm() {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم الدور مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/roles", {
        method: "POST",
        body: { name: name.trim(), ...(description.trim() === "" ? {} : { description: description.trim() }) },
      });
      notify("success", "تم إنشاء الدور.");
      setName("");
      setDescription("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الإنشاء."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        الاسم
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        الوصف (اختياري)
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        إنشاء الدور
      </Button>
    </form>
  );
}

export function RolePatchForm({
  id,
  name,
  description,
  isActive,
}: {
  id: string;
  name: string;
  description: string | null;
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
      setNote("اسم الدور مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${id}`, {
        method: "PATCH",
        body: { name: nextName.trim(), isActive: nextActive },
      });
      notify("success", "تم حفظ الدور.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        الاسم
        <input value={nextName} onChange={(e) => setNextName(e.target.value)} maxLength={60} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextActive} onChange={(e) => setNextActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      {description ? <p className="text-sm text-secondary">{description}</p> : null}
      <Note text={note} />
      <Button type="submit" loading={pending}>
        حفظ الدور
      </Button>
    </form>
  );
}

export function RoleDeleteButton({ id, memberCount }: { id: string; memberCount: number }) {
  const router = useRouter();
  const { notify } = useToast();
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${id}`, { method: "DELETE" });
      notify("success", "تم حذف الدور.");
      router.push("/admin/roles");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحذف."));
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="grid gap-2">
        {memberCount > 0 ? (
          <p className="text-sm text-secondary">
            الدور مرتبط بمستخدمين — الحذف سيُرفض من الخادم (409) حتى يُفصل الأعضاء.
          </p>
        ) : null}
        <div>
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            حذف الدور
          </Button>
        </div>
        <Note text={note} />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <p role="alert" className="text-sm font-semibold">
        سيُحذف هذا الدور نهائيًا ولا يمكن التراجع. متابعة؟
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="danger" loading={pending} onClick={() => void remove()}>
          تأكيد الحذف
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
          تراجع
        </Button>
      </div>
      <Note text={note} />
    </div>
  );
}

export function RoleGrantsManager({
  roleId,
  granted,
  allPermissions,
}: {
  roleId: string;
  granted: string[];
  allPermissions: { id: string; key: string; description: string | null }[];
}) {
  const { notify } = useToast();
  const [permissionId, setPermissionId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (pending || permissionId === "") return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${roleId}/grants`, { method: "POST", body: { permissionId } });
      notify("success", "تم منح الصلاحية.");
      setPermissionId("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر المنح."));
    } finally {
      setPending(false);
    }
  }

  async function detach(pid: string) {
    setNote(null);
    try {
      await apiRequest(`/api/admin/roles/${roleId}/grants/${pid}`, { method: "DELETE" });
      notify("success", "تم سحب الصلاحية.");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر السحب."));
    }
  }

  const options = allPermissions.filter((p) => !granted.includes(p.key));

  return (
    <div className="grid gap-2">
      <ul className="grid gap-1">
        {granted.length === 0 ? <li className="text-sm text-secondary">لا توجد صلاحيات ممنوحة.</li> : null}
        {granted.map((key) => {
          const row = allPermissions.find((p) => p.key === key);
          return (
            <li key={key} className="flex items-center justify-between gap-2 rounded-card border border-line bg-white px-3 py-2 text-sm">
              <span dir="ltr" className="font-mono">{key}</span>
              {row ? (
                <button type="button" onClick={() => void detach(row.id)} className="min-h-[44px] px-3 font-semibold text-error">
                  سحب
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form onSubmit={(e) => void attach(e)} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-semibold">
          منح صلاحية
          <select value={permissionId} onChange={(e) => setPermissionId(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
            <option value="">— اختر —</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.key}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" loading={pending}>
          منح
        </Button>
      </form>
      <Note text={note} />
    </div>
  );
}
