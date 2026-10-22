// Phase-10 product create island ("use client").
//
// Contract: POST /api/admin/catalog/products (server guard `products.create`).
// Body shape = `productInputSchema` (strict — unknown keys are rejected), so
// this form sends ONLY the contract keys.
//
// Sale model: `productInputSchema` allows productType PIECE|WEIGHT and unit
// PIECE|KG|GRAM, and the domain rule (`assertProductWeightShape`) requires
// PIECE -> unit=PIECE with no sale step, WEIGHT -> unit in {KG, GRAM} with a
// positive saleStepGrams. The unit choices below are therefore DERIVED FROM
// the selected product type — an operator is never offered a weight unit for
// a piece product, nor a piece unit for a weight product.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type ProductType = "PIECE" | "WEIGHT";
type Unit = "PIECE" | "KG" | "GRAM";

const UNIT_OPTIONS: Record<ProductType, { value: Unit; label: string }[]> = {
  PIECE: [{ value: "PIECE", label: "قطعة (PIECE)" }],
  WEIGHT: [
    { value: "KG", label: "كيلوجرام (KG)" },
    { value: "GRAM", label: "جرام (GRAM)" },
  ],
};

export function ProductCreateForm({
  categories,
  brands,
}: {
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [productType, setProductType] = useState<ProductType>("PIECE");
  const [unit, setUnit] = useState<Unit>("PIECE");
  const [saleStepGrams, setSaleStepGrams] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function changeType(next: ProductType) {
    setProductType(next);
    // Unit follows the sale model — never leave an incompatible unit selected.
    setUnit(UNIT_OPTIONS[next][0].value);
    if (next === "PIECE") setSaleStepGrams("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم المنتج مطلوب.");
      return;
    }
    if (categoryId === "") {
      setNote("اختر التصنيف — المنتج لا يُنشأ بدون تصنيف.");
      return;
    }
    const step = saleStepGrams.trim() === "" ? null : Number(saleStepGrams);
    if (productType === "WEIGHT" && (step === null || !Number.isInteger(step) || step <= 0)) {
      setNote("المنتج بالوزن يحتاج خطوة بيع بالجرام رقمًا صحيحًا أكبر من صفر.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/products", {
        method: "POST",
        body: {
          name: name.trim(),
          ...(slug.trim() === "" ? {} : { slug: slug.trim() }),
          ...(description.trim() === "" ? {} : { description: description.trim() }),
          categoryId,
          ...(brandId === "" ? {} : { brandId }),
          productType,
          unit,
          ...(productType === "WEIGHT" && step !== null ? { saleStepGrams: step } : {}),
          isActive,
        },
      });
      notify("success", "تم إنشاء المنتج.");
      setName("");
      setSlug("");
      setDescription("");
      setBrandId("");
      setSaleStepGrams("");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر إنشاء المنتج."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-[560px] gap-3">
      <Field label="اسم المنتج" required>
        {({ inputId, describedBy }) => (
          <TextInput inputId={inputId} describedBy={describedBy} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نموذج البيع" required>
          {({ inputId }) => (
            <select
              id={inputId}
              value={productType}
              onChange={(e) => changeType(e.target.value as ProductType)}
              className="min-h-[44px] rounded-control border border-line bg-white px-2"
            >
              <option value="PIECE">بالقطعة (PIECE)</option>
              <option value="WEIGHT">بالوزن (WEIGHT)</option>
            </select>
          )}
        </Field>
        <Field label="وحدة البيع" required hint="وحدة البيع مرتبطة بنموذج البيع.">
          {({ inputId, describedBy }) => (
            <select
              id={inputId}
              aria-describedby={describedBy}
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              className="min-h-[44px] rounded-control border border-line bg-white px-2"
            >
              {UNIT_OPTIONS[productType].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {productType === "WEIGHT" ? (
        <Field label="خطوة البيع (جرام)" required hint="قيمة موجبة: أصغر كمية تُباع من المنتج.">
          {({ inputId, describedBy }) => (
            <TextInput
              inputId={inputId}
              describedBy={describedBy}
              value={saleStepGrams}
              onChange={(e) => setSaleStepGrams(e.target.value)}
              inputMode="numeric"
              required
            />
          )}
        </Field>
      ) : null}
      <Field label="التصنيف" required hint="التصنيف مطلوب لإنشاء المنتج.">
        {({ inputId, describedBy }) => (
          <select
            id={inputId}
            aria-describedby={describedBy}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="min-h-[44px] rounded-control border border-line bg-white px-2"
            required
          >
            <option value="">— اختر التصنيف —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="العلامة التجارية (اختياري)">
        {({ inputId }) => (
          <select
            id={inputId}
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="min-h-[44px] rounded-control border border-line bg-white px-2"
          >
            <option value="">— بدون علامة —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="المعرّف في الرابط (slug) — اختياري">
        {({ inputId }) => (
          <TextInput inputId={inputId} value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={180} dir="ltr" />
        )}
      </Field>
      <Field label="الوصف — اختياري">
        {({ inputId }) => (
          <TextInput inputId={inputId} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        )}
      </Field>
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
        إنشاء المنتج
      </Button>
    </form>
  );
}
