// SETTING FORMS ISLAND ("use client"): one typed editor per store setting.
//
// The value always travels as text; the server re-checks it against the
// setting's own type, so the client never decides what is valid. The input
// only mirrors the type so the operator types what the store expects.
//
// The storefront toast is not used: the admin panel has no toast host, so the
// island reports the outcome in its own note.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { settingLabel } from "@/lib/admin/terminology";
import {
  AdminButton,
  AdminChoices,
  AdminField,
  AdminInput,
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

export function SettingEditForm({
  settingKey,
  value,
  valueType,
}: {
  settingKey: string;
  value: string;
  valueType: string;
}) {
  const router = useRouter();
  const [next, setNext] = useState(value);
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setNote(null);
    if (next === value) {
      setNote({ tone: "bad", text: "القيمة لسه زي ما هي. عدّلها الأول." });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/settings/${settingKey}`, { method: "PATCH", body: { value: next } });
      setNote({ tone: "ok", text: `تم حفظ «${settingLabel(settingKey)}».` });
      router.refresh();
    } catch (error) {
      setNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نحفظ الإعداد دلوقتي. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="adm-form">
      <AdminField label="القيمة الجديدة" hint={`إعداد ${settingLabel(settingKey)}.`}>
        {({ inputId, describedBy }) =>
          valueType === "BOOLEAN" ? (
            <AdminChoices
              name={`setting-${settingKey}`}
              value={next}
              onChange={setNext}
              options={[
                { value: "true", title: "مفعّل", hint: "القيمة تشتغل" },
                { value: "false", title: "موقوف", hint: "القيمة مقفولة" },
              ]}
            />
          ) : valueType === "JSON" ? (
            <AdminTextarea
              inputId={inputId}
              describedBy={describedBy}
              value={next}
              onChange={(event) => setNext(event.target.value)}
              dir="ltr"
            />
          ) : valueType === "INTEGER" || valueType === "NUMERIC" ? (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={next}
              onChange={(event) => setNext(event.target.value)}
              type="number"
              inputMode="decimal"
              dir="ltr"
            />
          ) : (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          )
        }
      </AdminField>
      {note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending} size="sm">
          احفظ
        </AdminButton>
      </div>
    </form>
  );
}
