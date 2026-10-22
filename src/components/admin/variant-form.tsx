// Phase-10 variant island ("use client"): create a variant for a product, or
// edit the existing variant's descriptive fields.
//
// Contracts (server guards in parentheses):
//   POST /api/admin/catalog/products/[productId]/variants  (products.create)
//       body = variantInputSchema.omit({ productId }) -> { name, sizeValue?, sizeUnit?,
//       price, compareAtPrice?, costPrice?, isActive? }
//   PATCH /api/admin/catalog/variants/[id]                 (products.update)
//       body = variantPatchSchema -> { name?, sizeValue?, sizeUnit?, compareAtPrice?,
//       costPrice?, isActive? }
//
// The selling price is NOT part of the edit payload on purpose: the price has
// its own endpoint (`PATCH .../variants/[id]/price`) that writes the price
// history row and the audit row in one transaction. Mixing the two would
// silently bypass the price history.
//
// Domain rules mirrored here (the server re-checks both):
//   sizeValue, when present, must be positive.
//   compareAtPrice, when present, must be >= the selling price.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const SIZE_UNITS = [
  { value: "PIECE", label: "قطعة (PIECE)" },
  { value: "KG", label: "كيلوجرام (KG)" },
  { value: "GRAM", label: "جرام (GRAM)" },
  { value: "LITER", label: "لتر (LITER)" },
  { value: "ML", label: "ملليلتر (ML)" },
];

const DECIMAL_2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL_3 = /^\d+(\.\d{1,3})?$/;

export type VariantFormValues = {
  id?: string;
  name: string;
  sizeValue: string | null;
  sizeUnit: string | null;
  price: string;
  compareAtPrice: string | null;
  costPrice: string | null;
  isActive: boolean;
};

export function VariantCreateForm({ productId }: { productId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnit, setSizeUnit] = useState("");
  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم المتغير مطلوب.");
      return;
    }
    if (!DECIMAL_2.test(price.trim()) || Number(price.trim()) <= 0) {
      setNote("السعر مطلوب ويجب أن يكون رقمًا موجبًا برقمين عشريين حدًا أقصى.");
      return;
    }
    if (sizeValue.trim() !== "" && !DECIMAL_3.test(sizeValue.trim())) {
      setNote("حجم المتغير يجب أن يكون رقمًا بثلاث خانات عشرية كحد أقصى.");
      return;
    }
    if (compareAtPrice.trim() !== "") {
      if (!DECIMAL_2.test(compareAtPrice.trim())) {
        setNote("السعر قبل الخصم يجب أن يكون رقمًا برقمين عشريين حدًا أقصى.");
        return;
      }
      if (Number(compareAtPrice.trim()) < Number(price.trim())) {
        setNote("السعر قبل الخصم يجب أن يكون مساويًا أو أكبر من سعر البيع.");
        return;
      }
    }
    if (costPrice.trim() !== "" && !DECIMAL_2.test(costPrice.trim())) {
      setNote("سعر التكلفة يجب أن يكون رقمًا برقمين عشريين حدًا أقصى.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/products/${productId}/variants`, {
        method: "POST",
        body: {
          name: name.trim(),
          ...(sizeValue.trim() === "" ? {} : { sizeValue: sizeValue.trim() }),
          ...(sizeUnit === "" ? {} : { sizeUnit }),
          price: price.trim(),
          ...(compareAtPrice.trim() === "" ? {} : { compareAtPrice: compareAtPrice.trim() }),
          ...(costPrice.trim() === "" ? {} : { costPrice: costPrice.trim() }),
          isActive: true,
        },
      });
      notify("success", "تم إنشاء المتغير.");
      setName("");
      setSizeValue("");
      setSizeUnit("");
      setPrice("");
      setCompareAtPrice("");
      setCostPrice("");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر إنشاء المتغير."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-[560px] gap-3">
      <Field label="اسم المتغير" required hint="مثال: كيس 500 جرام، عبوة 1 كجم.">
        {({ inputId, describedBy }) => (
          <TextInput inputId={inputId} describedBy={describedBy} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="حجم المتغير (اختياري)">
          {({ inputId }) => (
            <TextInput inputId={inputId} value={sizeValue} onChange={(e) => setSizeValue(e.target.value)} inputMode="decimal" />
          )}
        </Field>
        <Field label="وحدة الحجم (اختياري)">
          {({ inputId }) => (
            <select id={inputId} value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
              <option value="">— بدون —</option>
              {SIZE_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="سعر البيع" required>
          {({ inputId }) => (
            <TextInput inputId={inputId} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" required />
          )}
        </Field>
        <Field label="السعر قبل الخصم (اختياري)">
          {({ inputId }) => (
            <TextInput inputId={inputId} value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
          )}
        </Field>
        <Field label="سعر التكلفة (اختياري)">
          {({ inputId }) => (
            <TextInput inputId={inputId} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
          )}
        </Field>
      </div>
      {note ? (
        <p role="alert" className="text-sm text-error">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        إنشاء المتغير
      </Button>
    </form>
  );
}

export function VariantEditForm({
  variant,
  canEditCost = true,
}: {
  variant: Required<VariantFormValues>;
  /**
   * `prices.update` — may the operator WRITE the cost basis? (G01: the cost
   * field is a price field, so writing it needs the price capability.)
   */
  canEditCost?: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState(variant.name);
  const [sizeValue, setSizeValue] = useState(variant.sizeValue ?? "");
  const [sizeUnit, setSizeUnit] = useState(variant.sizeUnit ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState(variant.compareAtPrice ?? "");
  const [costPrice, setCostPrice] = useState(variant.costPrice ?? "");
  const [isActive, setIsActive] = useState(variant.isActive);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم المتغير مطلوب.");
      return;
    }
    if (sizeValue.trim() !== "" && !DECIMAL_3.test(sizeValue.trim())) {
      setNote("حجم المتغير يجب أن يكون رقمًا بثلاث خانات عشرية كحد أقصى.");
      return;
    }
    if (compareAtPrice.trim() !== "") {
      if (!DECIMAL_2.test(compareAtPrice.trim())) {
        setNote("السعر قبل الخصم يجب أن يكون رقمًا برقمين عشريين حدًا أقصى.");
        return;
      }
      if (Number(compareAtPrice.trim()) < Number(variant.price)) {
        setNote(`السعر قبل الخصم يجب ألا يقل عن سعر البيع الحالي (${variant.price}).`);
        return;
      }
    }
    if (costPrice.trim() !== "" && !DECIMAL_2.test(costPrice.trim())) {
      setNote("سعر التكلفة يجب أن يكون رقمًا برقمين عشريين حدًا أقصى.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/variants/${variant.id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          sizeValue: sizeValue.trim() === "" ? null : sizeValue.trim(),
          sizeUnit: sizeUnit === "" ? null : sizeUnit,
          compareAtPrice: compareAtPrice.trim() === "" ? null : compareAtPrice.trim(),
          // The cost basis is a PRICE field: it is only sent when the operator
          // holds the price capability (G01 — the server enforces the same).
          ...(canEditCost
            ? { costPrice: costPrice.trim() === "" ? null : costPrice.trim() }
            : {}),
          isActive,
        },
      });
      notify("success", "تم حفظ المتغير.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-[560px] gap-3">
      <p className="text-sm text-secondary">
        سعر البيع الحالي: <bdi>{variant.price} ج.م</bdi> — لتغيير السعر استخدم قسم «تعديل السعر» (يُسجّل في تاريخ الأسعار).
      </p>
      <Field label="اسم المتغير" required>
        {({ inputId }) => (
          <TextInput inputId={inputId} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="حجم المتغير">
          {({ inputId }) => (
            <TextInput inputId={inputId} value={sizeValue} onChange={(e) => setSizeValue(e.target.value)} inputMode="decimal" />
          )}
        </Field>
        <Field label="وحدة الحجم">
          {({ inputId }) => (
            <select id={inputId} value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
              <option value="">— بدون —</option>
              {SIZE_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="السعر قبل الخصم">
          {({ inputId }) => (
            <TextInput inputId={inputId} value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
          )}
        </Field>
        {canEditCost ? (
          <Field label="سعر التكلفة">
            {({ inputId }) => (
              <TextInput inputId={inputId} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
            )}
          </Field>
        ) : (
          <p className="self-end text-xs text-secondary">
            سعر التكلفة يتطلب صلاحية <span dir="ltr" className="font-mono">prices.update</span> للتعديل.
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      {note ? (
        <p role="alert" className="text-sm text-error">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        حفظ المتغير
      </Button>
    </form>
  );
}
