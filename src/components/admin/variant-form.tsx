// Variant island ("use client"): add a sellable shape to a product, or edit
// the descriptive fields of an existing shape.
//
// Contracts (server guards in parentheses):
//   POST /api/admin/catalog/products/[productId]/variants  (products.create)
//       body = variantInputSchema.omit({ productId }) -> { name, sizeValue?, sizeUnit?,
//       price, compareAtPrice?, costPrice?, isActive? }
//   PATCH /api/admin/catalog/variants/[id]                  (products.update)
//       body = variantPatchSchema -> { name?, sizeValue?, sizeUnit?, compareAtPrice?,
//       costPrice?, isActive? }
//
// The selling price is NOT part of the edit payload on purpose: the price has
// its own endpoint that writes the price history row and the audit row in one
// transaction. Mixing the two would silently bypass the price history.
//
// Domain rules mirrored here (the server re-checks both):
//   sizeValue, when present, must be positive.
//   compareAtPrice, when present, must be >= the selling price.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminSelect,
} from "@/components/admin/ui/controls";
import { SIZE_UNIT_LABELS } from "@/lib/admin/terminology";

const DECIMAL_2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL_3 = /^\d+(\.\d{1,3})?$/;

export type VariantFormValues = {
  id?: string;
  name: string;
  sizeValue: string | null;
  sizeUnit: string | null;
  price?: string;
  compareAtPrice?: string | null;
  costPrice?: string | null;
  isActive: boolean;
};

function Feedback({ tone, children }: { tone: "success" | "danger"; children: React.ReactNode }) {
  return (
    <div className={`adm-note ${tone === "success" ? "adm-note--accent" : "adm-note--danger"}`} role="alert">
      <Info size={16} className="adm-note-icon" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function VariantCreateForm({ productId, canEditCost = false }: { productId: string; canEditCost?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnit, setSizeUnit] = useState("");
  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (name.trim() === "") {
      setFeedback({ tone: "danger", text: "اسم الشكل مطلوب." });
      return;
    }
    if (!DECIMAL_2.test(price.trim()) || Number(price.trim()) <= 0) {
      setFeedback({
        tone: "danger",
        text: "سعر البيع مطلوب، ولازم يكون رقم موجب برقمين عشريين على الأكثر.",
      });
      return;
    }
    if (sizeValue.trim() !== "" && !DECIMAL_3.test(sizeValue.trim())) {
      setFeedback({
        tone: "danger",
        text: "حجم الشكل لازم يكون رقم بثلاث خانات عشرية على الأكثر.",
      });
      return;
    }
    if (compareAtPrice.trim() !== "") {
      if (!DECIMAL_2.test(compareAtPrice.trim())) {
        setFeedback({
          tone: "danger",
          text: "السعر قبل الخصم لازم يكون رقم برقمين عشريين على الأكثر.",
        });
        return;
      }
      if (Number(compareAtPrice.trim()) < Number(price.trim())) {
        setFeedback({
          tone: "danger",
          text: "السعر قبل الخصم لازم يكون مساوي لسعر البيع أو أكبر منه.",
        });
        return;
      }
    }
    if (costPrice.trim() !== "" && !DECIMAL_2.test(costPrice.trim())) {
      setFeedback({
        tone: "danger",
        text: "سعر التكلفة لازم يكون رقم برقمين عشريين على الأكثر.",
      });
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
          ...(canEditCost && costPrice.trim() !== "" ? { costPrice: costPrice.trim() } : {}),
          isActive: true,
        },
      });
      setFeedback({ tone: "success", text: "تم إنشاء الشكل." });
      setName("");
      setSizeValue("");
      setSizeUnit("");
      setPrice("");
      setCompareAtPrice("");
      setCostPrice("");
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر إنشاء الشكل — راجع البيانات وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField
        label="اسم الشكل"
        required
        hint="الشكل اللي بيتباع فعلاً — مثال: كيس 500 جرام، علبة 12 قطعة."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField label="حجم الشكل" optional hint="الرقم اللي بيوضح حجم الشكل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={sizeValue}
              onChange={(e) => setSizeValue(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>

        <AdminField label="وحدة الحجم" optional hint="الوحدة اللي بيتقاس بيه الحجم.">
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={sizeUnit}
              onChange={(e) => setSizeUnit(e.target.value)}
            >
              <option value="">— بدون وحدة —</option>
              {Object.entries(SIZE_UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AdminSelect>
          )}
        </AdminField>
      </div>

      <div className="adm-form-grid">
        <AdminField label="سعر البيع" required hint="السعر اللي هيتباع بيه الشكل ده.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              required
            />
          )}
        </AdminField>

        <AdminField
          label="السعر قبل الخصم"
          optional
          hint="السعر القديم قبل العرض — لازم يكون أكبر من سعر البيع أو مساوي له."
        >
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={compareAtPrice}
              onChange={(e) => setCompareAtPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          )}
        </AdminField>

        {canEditCost ? (
          <AdminField label="سعر التكلفة" optional hint="اللي المتجر بيشتري فيه المنتج من المورّد.">
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            )}
          </AdminField>
        ) : null}
      </div>

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          أضف الشكل
        </AdminButton>
      </div>
    </form>
  );
}

/**
 * Picks one shape out of the product's shapes and edits its descriptive
 * fields. The pick lives here (not in the page) because the form state must
 * follow the picked shape.
 */
export function VariantEditPanel({
  variants,
  canEditCost = false,
  canEditPrices = false,
}: {
  variants: (VariantFormValues & { id: string })[];
  canEditCost?: boolean;
  canEditPrices?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "");
  const selected = variants.find((variant) => variant.id === selectedId) ?? null;

  if (!selected) {
    return <p className="adm-hint">مفيش أشكال بيع للتعديل.</p>;
  }

  return (
    <div className="adm-form">
      <AdminField label="شكل البيع" hint="اختار الشكل اللي عايز تعدّل بياناته.">
        {({ inputId, describedBy }) => (
          <AdminSelect
            inputId={inputId}
            describedBy={describedBy}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </AdminSelect>
        )}
      </AdminField>

      <VariantEditForm key={selected.id} variant={selected} canEditCost={canEditCost} canEditPrices={canEditPrices} />
    </div>
  );
}

export function VariantEditForm({
  variant,
  canEditCost = false,
  canEditPrices = false,
}: {
  variant: VariantFormValues & { id: string };
  canEditCost?: boolean;
  canEditPrices?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(variant.name);
  const [sizeValue, setSizeValue] = useState(variant.sizeValue ?? "");
  const [sizeUnit, setSizeUnit] = useState(variant.sizeUnit ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState(variant.compareAtPrice ?? "");
  const [costPrice, setCostPrice] = useState(variant.costPrice ?? "");
  const [isActive, setIsActive] = useState(variant.isActive);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (name.trim() === "") {
      setFeedback({ tone: "danger", text: "اسم الشكل مطلوب." });
      return;
    }
    if (sizeValue.trim() !== "" && !DECIMAL_3.test(sizeValue.trim())) {
      setFeedback({
        tone: "danger",
        text: "حجم الشكل لازم يكون رقم بثلاث خانات عشرية على الأكثر.",
      });
      return;
    }
    if (compareAtPrice.trim() !== "") {
      if (!DECIMAL_2.test(compareAtPrice.trim())) {
        setFeedback({
          tone: "danger",
          text: "السعر قبل الخصم لازم يكون رقم برقمين عشريين على الأكثر.",
        });
        return;
      }
      if (Number(compareAtPrice.trim()) < Number(variant.price)) {
        setFeedback({
          tone: "danger",
          text: `السعر قبل الخصم لازم ما يقلش عن سعر البيع الحالي (${variant.price}).`,
        });
        return;
      }
    }
    if (costPrice.trim() !== "" && !DECIMAL_2.test(costPrice.trim())) {
      setFeedback({
        tone: "danger",
        text: "سعر التكلفة لازم يكون رقم برقمين عشريين على الأكثر.",
      });
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
          ...(canEditPrices ? { compareAtPrice: compareAtPrice.trim() === "" ? null : compareAtPrice.trim() } : {}),
          ...(canEditCost
            ? { costPrice: costPrice.trim() === "" ? null : costPrice.trim() }
            : {}),
          isActive,
        },
      });
      setFeedback({ tone: "success", text: "تم حفظ بيانات الشكل." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر الحفظ — راجع البيانات وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      {variant.price !== undefined ? (
        <p className="adm-hint">
          سعر البيع الحالي: <bdi>{variant.price} ج.م</bdi> — لتغيير السعر استخدم قسم تعديل السعر، عشان
          التغيير يتسجل في تاريخ الأسعار.
        </p>
      ) : null}

      <AdminField label="اسم الشكل" required>
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField label="حجم الشكل">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={sizeValue}
              onChange={(e) => setSizeValue(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>

        <AdminField label="وحدة الحجم">
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={sizeUnit}
              onChange={(e) => setSizeUnit(e.target.value)}
            >
              <option value="">— بدون وحدة —</option>
              {Object.entries(SIZE_UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AdminSelect>
          )}
        </AdminField>
      </div>

      <div className="adm-form-grid">
        {canEditPrices ? (
          <AdminField label="السعر قبل الخصم">
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={compareAtPrice}
                onChange={(e) => setCompareAtPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            )}
          </AdminField>
        ) : null}

        {canEditCost ? (
          <AdminField label="سعر التكلفة">
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            )}
          </AdminField>
        ) : (
          <p className="adm-hint">سعر التكلفة محتاج صلاحية تعديل الأسعار عشان يتكتب.</p>
        )}
      </div>

      <div className="adm-field">
        <span className="adm-label">الظهور في المتجر</span>
        <div className="adm-choices" role="radiogroup" aria-label="الظهور في المتجر">
          <label className="adm-choice" htmlFor="ve-active-yes">
            <input
              id="ve-active-yes"
              type="radio"
              name="isActive"
              checked={isActive}
              onChange={() => setIsActive(true)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">معروض في المتجر</span>
            <span className="adm-choice-hint">العملاء يشوفوا الشكل ده ويقدروا يشتروا منه.</span>
          </label>
          <label className="adm-choice" htmlFor="ve-active-no">
            <input
              id="ve-active-no"
              type="radio"
              name="isActive"
              checked={!isActive}
              onChange={() => setIsActive(false)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">مخفي من المتجر</span>
            <span className="adm-choice-hint">يفضل موجود في الكتالوج بتاع الإدارة.</span>
          </label>
        </div>
      </div>

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ بيانات الشكل
        </AdminButton>
      </div>
    </form>
  );
}
