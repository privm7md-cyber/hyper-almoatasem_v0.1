// Phase-10 product code (barcode) island ("use client").
//
// Contract: POST /api/admin/catalog/codes (server guard `products.create`).
// Body shape = `codeInputSchema` (strict): { productVariantId, code, type, isPrimary? }.
//
// The code column is globally UNIQUE — a duplicate surfaces as 409 CONFLICT
// and is reported as such. The code text is case-sensitive and must not
// contain whitespace (the server's `codeStringSchema`).

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CodeCreateForm({
  variants,
}: {
  variants: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [variantId, setVariantId] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<"BARCODE" | "INTERNAL_CODE">("BARCODE");
  const [isPrimary, setIsPrimary] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (variants.length === 0) {
    return <p className="text-sm text-secondary">لا توجد متغيرات — أنشئ متغيرًا أولًا لتسجيل باركود.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (variantId === "") {
      setNote("اختر المتغير الذي يحمل الباركود.");
      return;
    }
    if (code.trim() === "" || /\s/.test(code.trim())) {
      setNote("الباركود مطلوب ويجب ألا يحتوي مسافات.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/codes", {
        method: "POST",
        body: { productVariantId: variantId, code: code.trim(), type, isPrimary },
      });
      notify("success", "تم تسجيل الباركود.");
      setCode("");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر تسجيل الباركود."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        المتغير
        <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2" required>
          <option value="">— اختر المتغير —</option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        الباركود
        <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={64} dir="ltr" required className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        نوع الكود
        <select value={type} onChange={(e) => setType(e.target.value as "BARCODE" | "INTERNAL_CODE")} className="min-h-[44px] rounded-control border border-line bg-white px-2">
          <option value="BARCODE">باركود (BARCODE)</option>
          <option value="INTERNAL_CODE">كود داخلي (INTERNAL_CODE)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} className="h-5 w-5" />
        الكود الأساسي لهذا المتغير
      </label>
      {note ? (
        <p role="alert" className="text-sm text-error">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        تسجيل الباركود
      </Button>
    </form>
  );
}
