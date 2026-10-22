// FE-10C product edit island ("use client"): PATCH products/[id] (name/description/isActive).
// Sends only provided fields (optional-only contract); server owns the rest.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function ProductEditForm({
  productId,
  name,
  description,
  isActive,
}: {
  productId: string;
  name: string;
  description: string | null;
  isActive: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [nextName, setNextName] = useState(name);
  const [nextDescription, setNextDescription] = useState(description ?? "");
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
      await apiRequest(`/api/admin/catalog/products/${productId}`, {
        method: "PATCH",
        body: {
          name: nextName.trim(),
          description: nextDescription.trim() === "" ? null : nextDescription.trim(),
          isActive: nextActive,
        },
      });
      notify("success", "تم حفظ المنتج.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <Field label="الاسم">
        {({ inputId, describedBy }) => (
          <TextInput inputId={inputId} describedBy={describedBy} value={nextName} onChange={(e) => setNextName(e.target.value)} />
        )}
      </Field>
      <Field label="الوصف (اختياري)">
        {({ inputId, describedBy }) => (
          <TextInput inputId={inputId} describedBy={describedBy} value={nextDescription} onChange={(e) => setNextDescription(e.target.value)} />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextActive} onChange={(e) => setNextActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      {note ? (
        <p role="alert" className="text-sm text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        حفظ المنتج
      </Button>
    </form>
  );
}
