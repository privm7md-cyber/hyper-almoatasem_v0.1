// FE-10F setting edit island ("use client"): per-key value patch.
// Wiring rule: value always sent as string; server-side coercion + validation
// by valueType is the only correctness gate.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

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
  const { notify } = useToast();
  const [next, setNext] = useState(value);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (next === value) {
      setNote("لا تغيير للحفظ.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/settings/${settingKey}`, { method: "PATCH", body: { value: next } });
      notify("success", "تم حفظ الإعداد.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2">
      <label className="grid min-w-[240px] flex-1 gap-1 text-sm font-semibold">
        القيمة (نص)
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          dir="ltr"
          className="min-h-[44px] rounded-control border border-line bg-white px-2 font-mono text-sm"
          aria-describedby={`setting-hint-${settingKey}`}
        />
      </label>
      <Button type="submit" size="sm" loading={pending} variant="secondary">
        حفظ
      </Button>
      {note ? (
        <p id={`setting-hint-${settingKey}`} role="alert" className="w-full text-sm text-secondary">
          {note}
        </p>
      ) : (
        <p id={`setting-hint-${settingKey}`} className="hidden" />
      )}
      <span className="sr-only">نوع القيمة {valueType}</span>
    </form>
  );
}
