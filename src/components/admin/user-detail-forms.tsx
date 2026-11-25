// USER DETAIL ISLANDS ("use client").
//
// Three jobs on one account page: edit the identity, set the secret, and
// attach or detach a role. Every operation is re-checked on the server
// (self-deactivation and last-owner guards live in the domain code) and the
// outcome is reported in Arabic, never with the server's English wording.
//
// Role names never reach the screen: the machine name stays in the value and
// the Arabic label is what the operator reads.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { roleLabel } from "@/lib/admin/terminology";
import { AdminButton, AdminChoices, AdminField, AdminInput, AdminSelect } from "@/components/admin/ui/controls";

/** The store's password floor — the server refuses anything shorter. */
const PASSWORD_MIN = 12;

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
  const router = useRouter();
  const [nextName, setNextName] = useState(name);
  const [nextEmail, setNextEmail] = useState(email);
  const [nextPhone, setNextPhone] = useState(phone ?? "");
  const [nextActive, setNextActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);

    const trimmedName = nextName.trim();
    const trimmedEmail = nextEmail.trim();
    const trimmedPhone = nextPhone.trim();
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
      await apiRequest(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: {
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone === "" ? null : trimmedPhone,
          isActive: nextActive,
        },
      });
      setSaved(true);
      router.refresh();
    } catch (failure) {
      setError(
        (failure as { code?: string } | null)?.code === "CONFLICT"
          ? "البريد الإلكتروني ده مستخدم في حساب تاني. جرّب بريد تاني."
          : adminErrorMessage(failure, "تعذّر حفظ بيانات الحساب. جرّب تاني."),
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
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
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
              value={nextEmail}
              onChange={(event) => setNextEmail(event.target.value)}
              maxLength={160}
              autoComplete="off"
            />
          )}
        </AdminField>
      </div>

      <AdminField label="التليفون" optional hint="من 8 لـ 15 رقم. سيبه فاضي تمسح التليفون من الحساب.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            type="tel"
            inputMode="numeric"
            dir="ltr"
            value={nextPhone}
            onChange={(event) => setNextPhone(event.target.value)}
            maxLength={15}
            autoComplete="off"
          />
        )}
      </AdminField>

      <div className="adm-field">
        <span className="adm-label">حالة الحساب</span>
        <AdminChoices
          name="user-active"
          value={nextActive ? "yes" : "no"}
          onChange={(value) => setNextActive(value === "yes")}
          options={[
            { value: "yes", title: "مفعّل", hint: "الحساب يقدر يدخل لوحة الإدارة." },
            {
              value: "no",
              title: "موقوف",
              hint: "الحساب مش هيقدر يدخل، وتاريخه بيفضل محفوظ.",
            },
          ]}
        />
      </div>

      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="adm-note adm-note--accent">بيانات الحساب اتحفظت.</p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          حفظ بيانات الحساب
        </AdminButton>
      </div>
    </form>
  );
}

export function UserPasswordForm({ id }: { id: string }) {
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
      await apiRequest(`/api/admin/users/${id}/password`, {
        method: "POST",
        body: { password },
      });
      setSaved(true);
      setPassword("");
      router.refresh();
    } catch (failure) {
      setError(adminErrorMessage(failure, "تعذّر ضبط كلمة المرور. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="adm-form" noValidate onSubmit={(event) => void submit(event)}>
      <AdminField
        label="كلمة مرور جديدة"
        required
        hint={`المتجر بيخزن كلمة السر مشفّرة ومش بيقدر يرجّعها. ${PASSWORD_MIN} حرف على الأقل.`}
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
        <p className="adm-note adm-note--accent">كلمة المرور اتحدّدت.</p>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending} variant="secondary">
          ضبط كلمة المرور
        </AdminButton>
      </div>
    </form>
  );
}

export function UserRolesManager({
  userId,
  assigned,
  allRoles,
}: {
  userId: string;
  /** Role names (machine keys) already held by the account. */
  assigned: string[];
  /** Every role in the store: id + machine name. */
  allRoles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const available = allRoles.filter((role) => !assigned.includes(role.name));

  async function attach(event: React.FormEvent) {
    event.preventDefault();
    if (pending || roleId === "") return;
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/users/${userId}/roles`, { method: "POST", body: { roleId } });
      setSaved("الدور اتضاف للحساب.");
      setRoleId("");
      router.refresh();
    } catch (failure) {
      setError(adminErrorMessage(failure, "تعذّر إضافة الدور. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  async function detach(targetRoleId: string) {
    if (pending) return;
    setError(null);
    setSaved(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/users/${userId}/roles/${targetRoleId}`, { method: "DELETE" });
      setSaved("الدور اتشال من الحساب.");
      router.refresh();
    } catch (failure) {
      setError(adminErrorMessage(failure, "تعذّر سحب الدور. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="adm-form">
      <div className="adm-field">
        <span className="adm-label">الأدوار اللي على الحساب</span>
        {assigned.length === 0 ? (
          <p className="adm-hint">الحساب ده مفيش عليه أي دور.</p>
        ) : (
          <div className="adm-chips">
            {assigned.map((name) => {
              const row = allRoles.find((role) => role.name === name);
              const label = roleLabel(name);
              return (
                <span className="adm-chip" key={name}>
                  {label}
                  {row ? (
                    <AdminButton
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => void detach(row.id)}
                      aria-label={`إزالة الدور ${label}`}
                    >
                      <X size={14} aria-hidden="true" />
                    </AdminButton>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <form className="adm-form" onSubmit={(event) => void attach(event)}>
        <AdminField label="إضافة دور" hint="الدور بيحدد إيه اللي الحساب يقدر يعمله في المتجر.">
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              <option value="">— اختار الدور —</option>
              {available.map((role) => (
                <option key={role.id} value={role.id}>
                  {roleLabel(role.name)}
                </option>
              ))}
            </AdminSelect>
          )}
        </AdminField>
        <div className="adm-btn-row">
          <AdminButton type="submit" size="sm" loading={pending} disabled={roleId === ""}>
            إضافة الدور
          </AdminButton>
        </div>
      </form>

      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="adm-note adm-note--accent">{saved}</p>
      ) : null}
    </div>
  );
}
