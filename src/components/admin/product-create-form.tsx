// Product create island ("use client") — one screen, four separated panels.
//
// The operator never reads a machine token: the sell type, the unit and the
// code type are chosen by meaning, and only the values that travel to the
// server stay machine tokens.
//
// The screen writes in three steps (product → first sellable shape → its
// barcode) because the store sells a shape, not an abstract product: a
// product with no shape and no price cannot be sold at the counter.

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
import { PRODUCT_TYPE_LABELS, SIZE_UNIT_LABELS, UNIT_LABELS } from "@/lib/admin/terminology";

type ProductType = "PIECE" | "WEIGHT";
type Unit = "PIECE" | "KG" | "GRAM";

/** The panel note: what this panel controls and what a wrong value causes. */
function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm-note adm-note--info">
      <Info size={16} className="adm-note-icon" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

function Feedback({ tone, children }: { tone: "success" | "danger"; children: React.ReactNode }) {
  return (
    <div className={`adm-note ${tone === "success" ? "adm-note--accent" : "adm-note--danger"}`} role="alert">
      <Info size={16} className="adm-note-icon" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function ProductCreateForm({
  categories,
  brands,
}: {
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [productType, setProductType] = useState<ProductType>("PIECE");
  const [unit, setUnit] = useState<Unit>("PIECE");
  const [saleStepGrams, setSaleStepGrams] = useState("");
  const [variantName, setVariantName] = useState("");
  const [variantSizeValue, setVariantSizeValue] = useState("");
  const [variantSizeUnit, setVariantSizeUnit] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
  const [variantBarcode, setVariantBarcode] = useState("");

  const [errors, setErrors] = useState<{
    name?: string;
    category?: string;
    step?: string;
    variantName?: string;
    variantPrice?: string;
  }>({});
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  function pickType(next: ProductType) {
    setProductType(next);
    // The unit follows the sell type — an incompatible unit is never left selected.
    setUnit(next === "PIECE" ? "PIECE" : "KG");
    if (next === "PIECE") setSaleStepGrams("");
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (name.trim() === "") next.name = "اكتب اسم المنتج — ده الاسم اللي هيظهر للعميل.";
    if (categoryId === "") next.category = "اختار التصنيف — المنتج مينفعش يفضل من غير تصنيف.";
    if (productType === "WEIGHT") {
      const grams = Number(saleStepGrams);
      if (
        saleStepGrams.trim() === "" ||
        !Number.isInteger(grams) ||
        grams <= 0
      ) {
        next.step = "اكتب خطوة البيع بالجرام — رقم صحيح أكبر من صفر (مثال: 125 يعني ربع كيلو).";
      }
    }
    if (variantName.trim() === "") next.variantName = "اكتب اسم الشكل اللي هيتباع — مثال: كيس 500 جرام.";
    if (!/^\d+(\.\d{1,2})?$/.test(variantPrice.trim()) || Number(variantPrice.trim()) <= 0) {
      next.variantPrice = "اكتب سعر البيع — رقم أكبر من صفر برقمين عشريين على الأكثر.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (!validate()) return;

    const grams = Number(saleStepGrams);
    let productId: string | null = null;
    setPending(true);
    try {
      const product = await apiRequest<{ id: string }>("/api/admin/catalog/products", {
        method: "POST",
        body: {
          name: name.trim(),
          ...(description.trim() === "" ? {} : { description: description.trim() }),
          categoryId,
          ...(brandId === "" ? {} : { brandId }),
          productType,
          unit,
          ...(productType === "WEIGHT" ? { saleStepGrams: grams } : {}),
          isActive: true,
        },
      });
      productId = product.data.id;

      const variant = await apiRequest<{ id: string }>(
        `/api/admin/catalog/products/${productId}/variants`,
        {
          method: "POST",
          body: {
            name: variantName.trim(),
            ...(variantSizeValue.trim() === "" ? {} : { sizeValue: variantSizeValue.trim() }),
            ...(variantSizeUnit === "" ? {} : { sizeUnit: variantSizeUnit }),
            price: variantPrice.trim(),
            isActive: true,
          },
        },
      );

      if (variantBarcode.trim() !== "") {
        try {
          await apiRequest("/api/admin/catalog/codes", {
            method: "POST",
            body: {
              productVariantId: variant.data.id,
              code: variantBarcode.trim(),
              type: "BARCODE",
              isPrimary: true,
            },
          });
        } catch {
          // The product and its shape are already saved — only the barcode failed.
          setFeedback({
            tone: "danger",
            text: "المنتج وشكل البيع اتسجلوا، بس الباركود ماتفحلش. افتح صفحة المنتج وسجّله من قسم الأكواد.",
          });
          router.push(`/admin/products/${productId}?created=1`);
          return;
        }
      }

      setFeedback({ tone: "success", text: "تم إنشاء المنتج وأول شكل للبيع." });
      router.push(`/admin/products/${productId}?created=1`);
    } catch (error) {
      if (productId) {
        setFeedback({
          tone: "danger",
          text: "المنتج اتسجل، بس أول شكل للبيع ماتفحلش. افتح صفحة المنتج وأكمل من هناك.",
        });
      } else {
        setFeedback({
          tone: "danger",
          text: adminErrorMessage(error, "تعذّر إنشاء المنتج — راجع البيانات وجرب تاني."),
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      {/* ------------------------------------------------ basics */}
      <section className="adm-panel">
        <div className="adm-panel-head">
          <div className="adm-panel-title">بيانات المنتج الأساسية</div>
        </div>
        <div className="adm-panel-body adm-form">
          <PanelNote>
            الاسم والوصف هما اللي العميل بيشوفهم في صفحة المنتج. لو الاسم غلط، هيبان غلط قدام كل
            العملاء، والوصف الغلط بيوصّل رسالة غلط.
          </PanelNote>

          <AdminField
            label="اسم المنتج"
            required
            error={errors.name}
            hint="الاسم اللي هيظهر في المتجر وفي الفاتورة — واضح ومفهوم للعميل."
          >
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                invalid={!!errors.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={160}
                required
              />
            )}
          </AdminField>

          <AdminField
            label="وصف مختصر"
            optional
            hint="سطرين عن المنتج: النوع أو الطعم أو الحجم. بيساعد العميل ياخد القرار."
          >
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
        </div>
      </section>

      {/* --------------------------------------- category and brand */}
      <section className="adm-panel">
        <div className="adm-panel-head">
          <div className="adm-panel-title">التصنيف والعلامة التجارية</div>
        </div>
        <div className="adm-panel-body adm-form">
          <PanelNote>
            التصنيف هو القسم اللي المنتج بيتحط تحته، والعلامة التجارية هي اسم الشركة. لو التصنيف غلط
            هتلاقي المنتج في قسم مش صح، ولو العلامة غلط هتبان المنتجات مش مظبوطة مع بعض.
          </PanelNote>

          <div className="adm-form-grid">
            <AdminField
              label="التصنيف"
              required
              error={errors.category}
              hint="كل منتج بيتحط في تصنيف واحد بس — مثال: الألبان، المنظفات، بقالة."
            >
              {({ inputId, describedBy }) => (
                <AdminSelect
                  inputId={inputId}
                  describedBy={describedBy}
                  invalid={!!errors.category}
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  required
                >
                  <option value="">— اختر التصنيف —</option>
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
              hint="اسم الشركة اللي بتعمل المنتج. سيبه فاضي لو المنتج مش تابع لعلامة."
            >
              {({ inputId, describedBy }) => (
                <AdminSelect
                  inputId={inputId}
                  describedBy={describedBy}
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                >
                  <option value="">— بدون علامة تجارية —</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </AdminSelect>
              )}
            </AdminField>
          </div>
        </div>
      </section>

      {/* --------------------------------------- sell type and unit */}
      <section className="adm-panel">
        <div className="adm-panel-head">
          <div className="adm-panel-title">طريقة البيع والوحدة</div>
        </div>
        <div className="adm-panel-body adm-form">
          <PanelNote>
            الطريقة دي بتحدد بيتحسب السعر ازاي وبتتقفل. منتج بالوزن بيتباع بخطوة معروفة، ومنتج
            بالقطعة ليه سعر واحد لكل شكل.
          </PanelNote>

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
                  hint: "للمنتجات اللي بتتباع بالعدد أو بالعبوة — زي علبة الجبنة.",
                },
                {
                  value: "WEIGHT",
                  title: PRODUCT_TYPE_LABELS.WEIGHT,
                  hint: "للمنتجات اللي بتتباع بوزنها — زي الجبنة الرومي.",
                },
              ]}
            />
          </div>

          {productType === "PIECE" ? (
            <p className="adm-hint">
              وحدة البيع: {UNIT_LABELS.PIECE} — بتتحدد لوحدها حسب طريقة البيع.
            </p>
          ) : (
            <div className="adm-form-grid">
              <AdminField
                label="وحدة البيع"
                required
                hint="الوحدة اللي بيتباع بيه المنتج بالوزن."
              >
                {({ inputId, describedBy }) => (
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
                )}
              </AdminField>

              <AdminField
                label="خطوة البيع"
                required
                error={errors.step}
                hint="أصغر كمية بتتباع من المنتج بالجرام — مثال: 125 يعني ربع كيلو."
              >
                {({ inputId, describedBy }) => (
                  <AdminInput
                    inputId={inputId}
                    describedBy={describedBy}
                    invalid={!!errors.step}
                    value={saleStepGrams}
                    onChange={(e) => setSaleStepGrams(e.target.value)}
                    inputMode="numeric"
                    required
                  />
                )}
              </AdminField>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------ first sellable shape */}
      <section className="adm-panel">
        <div className="adm-panel-head">
          <div className="adm-panel-title">أول شكل للبيع</div>
        </div>
        <div className="adm-panel-body adm-form">
          <PanelNote>
            الشكل هو الحاجة اللي بتتباع فعلاً، والسعر بتاعه هو اللي بيظهر للعميل. من غير شكل وسعر
            المنتج مش هيبان في المتجر ومش هيتباع في نقطة البيع.
          </PanelNote>

          <AdminField
            label="اسم الشكل"
            required
            error={errors.variantName}
            hint="الشكل اللي بيتباع — مثال: كيس 500 جرام، علبة 12 قطعة."
          >
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                invalid={!!errors.variantName}
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
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
                  value={variantSizeValue}
                  onChange={(e) => setVariantSizeValue(e.target.value)}
                  inputMode="decimal"
                />
              )}
            </AdminField>

            <AdminField label="وحدة الحجم" optional hint="الوحدة اللي بيتقاس بيه الحجم.">
              {({ inputId, describedBy }) => (
                <AdminSelect
                  inputId={inputId}
                  describedBy={describedBy}
                  value={variantSizeUnit}
                  onChange={(e) => setVariantSizeUnit(e.target.value)}
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
            <AdminField
              label="سعر البيع"
              required
              error={errors.variantPrice}
              hint="السعر بالجنيه اللي هيتباع بيه الشكل ده."
            >
              {({ inputId, describedBy }) => (
                <AdminInput
                  inputId={inputId}
                  describedBy={describedBy}
                  invalid={!!errors.variantPrice}
                  value={variantPrice}
                  onChange={(e) => setVariantPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
              )}
            </AdminField>

            <AdminField
              label="باركود الشكل"
              optional
              hint="الباركود اللي بيتقرا في نقطة البيع. سيبه فاضي لو المنتج لسه مالهوش باركود."
            >
              {({ inputId, describedBy }) => (
                <AdminInput
                  inputId={inputId}
                  describedBy={describedBy}
                  value={variantBarcode}
                  onChange={(e) => setVariantBarcode(e.target.value)}
                  maxLength={64}
                  dir="ltr"
                  inputMode="numeric"
                />
              )}
            </AdminField>
          </div>
        </div>
      </section>

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ المنتج
        </AdminButton>
      </div>

      <p className="adm-hint">
        بعد الحفظ هتنتقل لصفحة المنتج الجديدة، وتلاقي فيها المنتج وأول شكل للبيع وسعره. تقدر تضيف
        باقي الأشكال من نفس الصفحة.
      </p>
    </form>
  );
}
