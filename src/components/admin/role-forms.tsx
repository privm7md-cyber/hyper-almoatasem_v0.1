// ROLE FORMS ISLAND ("use client"): create, edit, delete and grant management.
//
// The server owns the rules (role protection, the grant ceiling, the audit
// pairing); this island only talks to the admin API and reports what happened
// in Arabic. The storefront toast is deliberately not used: the admin panel
// has no toast host, so its own notes are the honest feedback channel.
//
// The destructive step builds its own confirmation instead of the shared
// control: the question must be announced (role="alert") and must name the
// role and what its members lose.

"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { PERMISSION_GROUPS, permissionGroupOf, permissionLabel } from "@/lib/admin/terminology";
import {
  AdminButton,
  AdminChoices,
  AdminField,
  AdminInput,
  AdminSelect,
  AdminTextarea,
} from "@/components/admin/ui/controls";

type NoteTone = "ok" | "bad";

function InlineNote({ tone, children }: { tone: NoteTone; children: React.ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={tone === "bad" ? "adm-note adm-note--danger" : "adm-note adm-note--accent"}
    >
      <div>{children}</div>
    </div>
  );
}

/** Two-step destructive action: the question is announced before the answer. */
function DangerConfirm({
  label,
  confirmLabel,
  question,
  onConfirm,
  pending,
}: {
  label: string;
  confirmLabel: string;
  question: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <AdminButton variant="danger" onClick={() => setOpen(true)}>
        {label}
      </AdminButton>
    );
  }
  return (
    <div className="adm-note adm-note--danger" role="alert">
      <div>{question}</div>
      <div className="adm-btn-row">
        <AdminButton
          variant="danger"
          size="sm"
          loading={pending}
          onClick={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </AdminButton>
        <AdminButton variant="ghost" size="sm" onClick={() => setOpen(false)}>
          تراجع
        </AdminButton>
      </div>
    </div>
  );
}

export function RoleCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote({ tone: "bad", text: "اسم الدور مطلوب." });
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/roles", {
        method: "POST",
        body: { name: name.trim(), ...(description.trim() === "" ? {} : { description: description.trim() }) },
      });
      setName("");
      setDescription("");
      setNote({ tone: "ok", text: "تم إنشاء الدور. ابدأ تضيف صلاحياته من صفحة الدور." });
      router.refresh();
    } catch (error) {
      setNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نضيف الدور دلوقتي. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="adm-form">
      <div className="adm-form-grid">
        <AdminField
          label="اسم الدور"
          required
          hint="كلمة واحدة من غير مسافات، زي «كاشير». الاسم ده اللي الفريق هيشوفه."
        >
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
            />
          )}
        </AdminField>
        <AdminField label="وصف الدور" optional hint="جملة واحدة توضح الدور ده بيعمل إيه.">
          {({ inputId, describedBy }) => (
            <AdminTextarea
              inputId={inputId}
              describedBy={describedBy}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
            />
          )}
        </AdminField>
      </div>
      {note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          أضف الدور
        </AdminButton>
      </div>
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
  const router = useRouter();
  const [nextName, setNextName] = useState(name);
  const [nextDescription, setNextDescription] = useState(description ?? "");
  const [nextActive, setNextActive] = useState(isActive ? "true" : "false");
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setNote(null);
    if (nextName.trim() === "") {
      setNote({ tone: "bad", text: "اسم الدور مطلوب." });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${id}`, {
        method: "PATCH",
        body: {
          name: nextName.trim(),
          description: nextDescription.trim() === "" ? null : nextDescription.trim(),
          isActive: nextActive === "true",
        },
      });
      setNote({ tone: "ok", text: "تم حفظ بيانات الدور." });
      router.refresh();
    } catch (error) {
      setNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نحفظ بيانات الدور. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="adm-form">
      <div className="adm-form-grid">
        <AdminField label="اسم الدور" required hint="كلمة واحدة من غير مسافات.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
              maxLength={60}
              required
            />
          )}
        </AdminField>
        <AdminField label="حالة الدور" hint="الدور الموقوف ما بيدييش أي صلاحية لحد ما يرجع ينشط.">
          {() => (
            <AdminChoices
              name={`role-active-${id}`}
              value={nextActive}
              onChange={setNextActive}
              options={[
                { value: "true", title: "نشط", hint: "أعضاء الفريق بيشتغلوا بيه" },
                { value: "false", title: "موقوف", hint: "الدور موجود بس مالهوش أي صلاحية" },
              ]}
            />
          )}
        </AdminField>
        <AdminField label="وصف الدور" optional hint="اتركه فاضي لو مش محتاج توضح الدور.">
          {({ inputId, describedBy }) => (
            <AdminTextarea
              inputId={inputId}
              describedBy={describedBy}
              value={nextDescription}
              onChange={(event) => setNextDescription(event.target.value)}
              maxLength={2000}
            />
          )}
        </AdminField>
      </div>
      {note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ التعديلات
        </AdminButton>
      </div>
    </form>
  );
}

export function RoleDeleteButton({
  id,
  memberCount,
  roleName,
}: {
  id: string;
  memberCount: number;
  roleName: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function remove() {
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${id}`, { method: "DELETE" });
      router.push("/admin/roles");
      router.refresh();
    } catch (error) {
      setNote(adminErrorMessage(error, "مش قادرين نحذف الدور دلوقتي. حاول تاني."));
      setPending(false);
    }
  }

  const question = `هتحذف دور «${roleName}» نهائيًا ولا يمكن التراجع عنه. الأعضاء اللي يشغلون الدور ده هيبقوا من غير أي صلاحية من صلاحياته، والخطوة دي مفيش رجوع فيها.`;

  return (
    <div className="adm-form">
      {memberCount > 0 ? (
        <div className="adm-note adm-note--warn" role="note">
          <div>
            فيه {memberCount} عضو يشغل الدور ده، فحذف الدور سيُرفض من الخادم. شيل الدور من الأعضاء الأول
            وبعدين جرّب تاني.
          </div>
        </div>
      ) : null}
      <DangerConfirm
        label="حذف الدور"
        confirmLabel="تأكيد الحذف"
        question={question}
        pending={pending}
        onConfirm={() => void remove()}
      />
      {note ? <InlineNote tone="bad">{note}</InlineNote> : null}
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
  const router = useRouter();
  const [permissionId, setPermissionId] = useState("");
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const options = allPermissions.filter((permission) => !granted.includes(permission.key));
  const groups = PERMISSION_GROUPS.map((group) => ({
    title: group.title,
    items: options.filter((option) => group.permissions.some((permission) => permission.key === option.key)),
  })).filter((group) => group.items.length > 0);
  const ungrouped = options.filter((option) => permissionGroupOf(option.key) === null);

  async function attach() {
    if (pending || permissionId === "") return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${roleId}/grants`, { method: "POST", body: { permissionId } });
      setPermissionId("");
      setNote({ tone: "ok", text: "تم منح الصلاحية للدور." });
      router.refresh();
    } catch (error) {
      setNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نمنح الصلاحية. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  async function detach(id: string) {
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/roles/${roleId}/grants/${id}`, { method: "DELETE" });
      setNote({ tone: "ok", text: "تم سحب الصلاحية من الدور." });
      router.refresh();
    } catch (error) {
      setNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نسحب الصلاحية. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  const idOf = (key: string) => allPermissions.find((permission) => permission.key === key)?.id;

  return (
    <div className="adm-form">
      <AdminField
        label="صلاحية جديدة للدور"
        hint="الصلاحية بتظهر باسمها العادي، وتظهر تحت القسم اللي بتشتغل فيه."
      >
        {({ inputId, describedBy }) => (
          <AdminSelect
            inputId={inputId}
            describedBy={describedBy}
            value={permissionId}
            onChange={(event) => setPermissionId(event.target.value)}
          >
            <option value="">— اختار الصلاحية —</option>
            {groups.map((group) => (
              <optgroup key={group.title} label={group.title}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {permissionLabel(item.key)}
                  </option>
                ))}
              </optgroup>
            ))}
            {ungrouped.length > 0 ? (
              <optgroup label="صلاحيات تانية">
                {ungrouped.map((item) => (
                  <option key={item.id} value={item.id}>
                    {permissionLabel(item.key)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </AdminSelect>
        )}
      </AdminField>
      <div className="adm-btn-row">
        <AdminButton loading={pending} disabled={permissionId === ""} onClick={() => void attach()}>
          امنح الصلاحية
        </AdminButton>
      </div>

      <div className="adm-field">
        <span className="adm-label">الصلاحيات الموجودة في الدور</span>
        {granted.length === 0 ? (
          <p className="adm-hint">مفيش صلاحيات في الدور لسه. ابدأ من اللي فوق.</p>
        ) : (
          <dl className="adm-kv">
            {granted.map((key) => {
              const permissionId = idOf(key);
              return (
                <Fragment key={key}>
                  <dt>
                    <span className="adm-cell-main">
                      <span>{permissionLabel(key)}</span>
                      <span className="adm-cell-id" dir="ltr">
                        {key}
                      </span>
                    </span>
                  </dt>
                  <dd>
                    {permissionId ? (
                      <AdminButton
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => void detach(permissionId)}
                      >
                        اسحب
                      </AdminButton>
                    ) : null}
                  </dd>
                </Fragment>
              );
            })}
          </dl>
        )}
      </div>

      {note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}
    </div>
  );
}
