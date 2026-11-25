// Product edit island ("use client") — PATCH products/[id] with the full
// owner-approved contract: name/description/categoryId/brandId/isActive/
// productType/unit/saleStepGrams.
//
// The server owns the two-legal-states rule (piece → piece without a step,
// weight → a weight unit with a positive step) and answers 422 before any
// write when a transition is illegal. The form therefore says out loud when a
// sale value changes: that is a governed operation, never a silent switch.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import {
  AdminButton,
  AdminChoices,
  AdminField,
  AdminInput,
  AdminSelect,
  AdminTextarea,
} from "@/components/admin/ui/controls";
import { PRODUCT_TYPE_LABELS, UNIT_LABELS } from "@/lib/admin/terminology";

type ProductType = "PIECE" | "WEIGHT";
type Unit = "PIECE" | "KG" | "GRAM";

export interface ProductEditValues {
  name: string;
  description: string | null;
  isActive: boolean;
  categoryId: string;
  brandId: string | null;
  productType: ProductType;
  unit: Unit;
  saleStepGrams: number | null;
}

export function ProductEditForm({
  productId,
  product,
  categories,
  brands,
}: {
  productId: string;
  product: ProductEditValues;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [isActive, setIsActive] = useState(product.isActive);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [brandId, setBrandId] = useState(product.brandId ?? "");
  const [productType, setProductType] = useState<ProductType>(product.productType);
  const [unit, setUnit] = useState<Unit>(product.unit);
  const [saleStepGrams, setSaleStepGrams] = useState(product.saleStepGrams?.toString() ?? "");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const saleModelChanged =
    productType !== product.productType ||
    unit !== product.unit ||
    (productType === "WEIGHT" && Number(saleStepGrams) !== product.saleStepGrams);

  function pickType(next: ProductType) {
    setProductType(next);
    if (next === "PIECE") {
      setUnit("PIECE");
      setSaleStepGrams("");
    } else {
      // Keep a gram unit the product already had; otherwise default to kilo.
      setUnit(product.unit === "GRAM" ? "GRAM" : "KG");
      if (saleStepGrams === "") setSaleStepGrams(product.saleStepGrams?.toString() ?? "250");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (name.trim() === "") {
      setFeedback({ tone: "danger", text: "الاسم مطلوب — المنتج مينفعش يفضل من غير اسم." });
      return;
    }
    const step = saleStepGrams.trim() === "" ? null : Number(saleStepGrams);
    if (productType === "WEIGHT" && (step === null || !Number.isInteger(step) || step <= 0)) {
      setFeedback({
        tone: "danger",
        text: "المنتج بالوزن محتاج خطوة بيع بالجرام — رقم صحيح أكبر من صفر.",
      });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/products/${productId}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          description: description.trim() === "" ? null : description.trim(),
          isActive,
          categoryId,
          brandId: brandId === "" ? null : brandId,
          productType,
          unit,
          saleStepGrams: productType === "WEIGHT" ? step : null,
        },
      });
      setFeedback({ tone: "success", text: "تم حفظ التعديلات." });
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
      <AdminField
        label="اسم المنتج"
        required
        hint="الاسم اللي هيظهر للعميل في المتجر. لو الاسم تالف، اكتبه صح هنا — الاسم القديم بيتسجل في سجل التغييرات."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            required
          />
        )}
      </AdminField>

      <AdminField label="وصف مختصر" optional hint="سطرين عن المنتج بيساعدوا العميل ياخد القرار.">
        {({ inputId, describedBy }) => (
          <AdminTextarea
            inputId={inputId}
            describedBy={describedBy}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 4000))}
            maxLength={4000}
            rows={3}
          />
        )}
      </AdminField>

      <div className="adm-form-grid">
        <AdminField
          label="التصنيف"
          required
          hint="التصنيف هو القسم اللي المنتج بيتحط تحته."
        >
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {categories.some((category) => category.id === categoryId) ? null : (
                <option value={categoryId}>التصنيف الحالي</option>
              )}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </AdminSelect>
          )}
        </AdminField>

        <AdminField
          label="العلامة التجارية"
          optional
          hint="العلامة التجارية هي اسم الشركة. سيبها فاضية لو المنتج مش تابع لعلامة."
        >
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
            >
              <option value="">— بدون علامة تجارية —</option>
              {brands.some((brand) => brand.id === brandId) || brandId === "" ? null : (
                <option value={brandId}>العلامة الحالية</option>
              )}
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </AdminSelect>
          )}
        </AdminField>
      </div>

      <div className="adm-field">
        <span className="adm-label">
          طريقة البيع
          <span className="adm-required" aria-hidden="true">
            *
          </span>
        </span>
        <AdminChoices
          name="productType"
          value={productType}
          onChange={(value) => pickType(value as ProductType)}
          options={[
            {
              value: "PIECE",
              title: PRODUCT_TYPE_LABELS.PIECE,
              hint: "للمنتجات اللي بتتباع بالعدد أو بالعبوة.",
            },
            {
              value: "WEIGHT",
              title: PRODUCT_TYPE_LABELS.WEIGHT,
              hint: "للمنتجات اللي بتتباع بوزنها.",
            },
          ]}
        />
      </div>

      <div className="adm-form-grid">
        <AdminField
          label="وحدة البيع"
          required
          hint={
            productType === "PIECE"
              ? "مرتبطة بطريقة البيع — بتتباع بالقطعة."
              : "وحدة الوزن اللي بيتباع بيه المنتج."
          }
        >
          {({ inputId, describedBy }) =>
            productType === "PIECE" ? (
              <AdminInput inputId={inputId} describedBy={describedBy} value={UNIT_LABELS.PIECE} readOnly />
            ) : (
              <AdminSelect
                inputId={inputId}
                describedBy={describedBy}
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                required
              >
                <option value="KG">{UNIT_LABELS.KG}</option>
                <option value="GRAM">{UNIT_LABELS.GRAM}</option>
              </AdminSelect>
            )
          }
        </AdminField>

        {productType === "WEIGHT" ? (
          <AdminField
            label="خطوة البيع"
            required
            hint="أصغر كمية بتتباع بالجرام — مثال: 125 يعني ربع كيلو."
          >
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={saleStepGrams}
                onChange={(e) => setSaleStepGrams(e.target.value)}
                inputMode="numeric"
                required
              />
            )}
          </AdminField>
        ) : null}
      </div>

      {saleModelChanged ? (
        <div className="adm-note adm-note--warn" role="status">
          <Info size={16} className="adm-note-icon" aria-hidden="true" />
          <div>
            غيّرت طريقة البيع أو وحدتها. الخادم بيراجع التغيير حسب قواعد البيع الأصلية للمنتج، ولو
            التعديل مش متوافق هيرفضه ويقول لك السبب.
          </div>
        </div>
      ) : null}

      <div className="adm-field">
        <label className="adm-label" htmlFor="pe-active">
          الظهور في المتجر
        </label>
        <div className="adm-choices" role="radiogroup" aria-label="الظهور في المتجر">
          <label className="adm-choice" htmlFor="pe-active-yes">
            <input
              id="pe-active-yes"
              type="radio"
              name="isActive"
              checked={isActive}
              onChange={() => setIsActive(true)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">معروض في المتجر</span>
            <span className="adm-choice-hint">العملاء يشوفوه ويقدروا يشتروا منه.</span>
          </label>
          <label className="adm-choice" htmlFor="pe-active-no">
            <input
              id="pe-active-no"
              type="radio"
              name="isActive"
              checked={!isActive}
              onChange={() => setIsActive(false)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">مخفي من المتجر</span>
            <span className="adm-choice-hint">يفضل في الكتالوج بتاع الإدارة، بس مش بيظهر للعملاء.</span>
          </label>
        </div>
      </div>

      {feedback ? (
        <div
          className={`adm-note ${feedback.tone === "success" ? "adm-note--accent" : "adm-note--danger"}`}
          role="alert"
        >
          <Info size={16} className="adm-note-icon" aria-hidden="true" />
          <div>{feedback.text}</div>
        </div>
      ) : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ التعديلات
        </AdminButton>
      </div>
    </form>
  );
}
