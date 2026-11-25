// Promotion write forms (client): every picker shows what the choice MEANS, never a token.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import {
  PROMOTION_SCOPE_LABELS,
  PROMOTION_SCOPE_MEANING,
  PROMOTION_STATUS_LABELS,
  PROMOTION_TARGET_LABELS,
  PROMOTION_TYPE_LABELS,
} from "@/lib/admin/terminology";
import {
  AdminButton,
  AdminChoices,
  AdminField,
  AdminInput,
  ConfirmButton,
} from "@/components/admin/ui/controls";

/** One line per discount kind, so the operator picks by meaning. */
const TYPE_HINTS: Record<string, string> = {
  PERCENTAGE: "نسبة بتتحسب على قيمة المنتج أو على إجمالي الطلب، زي 10%.",
  FIXED_AMOUNT: "مبلغ ثابت بيتشال من قيمة المنتج أو من إجمالي الطلب.",
  FIXED_PRICE: "المنتج بيتباع بسعر محدد مهما كان سعره قبل العرض.",
  BUY_X_GET_Y: "العميل يشتري كمية وبياخد كمية تانية بنص السعر أو بخصم.",
};

const STATUS_HINTS: Record<string, string> = {
  DRAFT: "العرض محفوظ بس مش بيتطبّق على أي طلب.",
  ACTIVE: "العرض بيتطبّق على الطلبات في تاريخه.",
  DISABLED: "العرض متوقف مؤقتًا ومينفعش يشتغل.",
};

const TARGET_HINTS: Record<string, string> = {
  VARIANT: "شكل بيع واحد بالوزن أو بالقطعة.",
  PRODUCT: "كل أشكال المنتج بتاخد الخصم.",
  BRAND: "كل منتجات العلامة التجارية بتاخد الخصم.",
  CATEGORY: "كل منتجات التصنيف، بما فيه التصنيفات اللي تحته.",
};

/** These two kinds can only sit on the products the offer targets. */
const LINE_ONLY_TYPES = new Set(["FIXED_PRICE", "BUY_X_GET_Y"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/** The scope cards, with the shared meaning of each choice. */
const SCOPE_OPTIONS = (Object.keys(PROMOTION_SCOPE_LABELS) as string[]).map((value) => ({
  value,
  title: PROMOTION_SCOPE_LABELS[value] ?? "غير معروف",
  hint: PROMOTION_SCOPE_MEANING[value] ?? "",
}));

/** The status cards, with what each state does to the orders. */
const STATUS_OPTIONS = (Object.keys(PROMOTION_STATUS_LABELS) as string[]).map((value) => ({
  value,
  title: PROMOTION_STATUS_LABELS[value] ?? "غير معروف",
  hint: STATUS_HINTS[value] ?? "",
}));

const TYPE_OPTIONS = (Object.keys(PROMOTION_TYPE_LABELS) as string[]).map((value) => ({
  value,
  title: PROMOTION_TYPE_LABELS[value] ?? "غير معروف",
  hint: TYPE_HINTS[value] ?? "",
}));

const TARGET_OPTIONS = (Object.keys(PROMOTION_TARGET_LABELS) as string[]).map((value) => ({
  value,
  title: PROMOTION_TARGET_LABELS[value] ?? "غير معروف",
  hint: TARGET_HINTS[value] ?? "",
}));

/** `datetime-local` needs "YYYY-MM-DDTHH:mm"; the API needs an offset. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local wall-clock value -> ISO string with the browser's own UTC offset. */
export function fromLocalInput(value: string): string | null {
  if (value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="adm-error">
      {text}
    </p>
  );
}

/** A radio group the operator reads by meaning, so it needs its own name. */
function ChoiceField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="adm-field" role="group" aria-label={label}>
      <span className="adm-label">{label}</span>
      {children}
      <p className="adm-hint">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------ create offer */

export function PromotionCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("PERCENTAGE");
  const [scope, setScope] = useState("LINE");
  const [value, setValue] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const lineOnly = LINE_ONLY_TYPES.has(type);
  const effectiveScope = lineOnly ? "LINE" : scope;
  const valueField =
    type === "PERCENTAGE"
      ? { label: "نسبة الخصم", hint: "رقم من 1 لحد 100، من غير علامة النسبة." }
      : type === "FIXED_AMOUNT"
        ? { label: "مبلغ الخصم", hint: "مبلغ بالجنيه المصري، من غير رمز العملة." }
        : type === "FIXED_PRICE"
          ? { label: "السعر الثابت", hint: "السعر النهائي للمنتج بالجنيه المصري." }
          : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (name.trim() === "") {
      setError("اسم العرض مطلوب.");
      return;
    }
    const body: Record<string, unknown> = { name: name.trim(), type, scope: effectiveScope };
    if (description.trim() !== "") body.description = description.trim();
    if (valueField) {
      const raw = value.trim();
      if (raw === "") {
        setError("قيمة الخصم مطلوبة — العرض من غير قيمة مش بيتقبل.");
        return;
      }
      if (type === "PERCENTAGE") {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
          setError("نسبة الخصم لازم تكون رقم أكبر من صفر ونهائيته 100.");
          return;
        }
        body.discountPercent = raw;
      } else {
        if (!MONEY_RE.test(raw)) {
          setError("قيمة الخصم لازم تكون رقم بمقلبين عشريين على الأكثر.");
          return;
        }
        body[type === "FIXED_AMOUNT" ? "discountAmount" : "fixedPrice"] = raw;
      }
    }
    const startIso = fromLocalInput(startAt);
    const endIso = fromLocalInput(endAt);
    if (startAt !== "" && startIso === null) {
      setError("تاريخ البداية مش مظبوط.");
      return;
    }
    if (endAt !== "" && endIso === null) {
      setError("تاريخ النهاية مش مظبوط.");
      return;
    }
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      setError("تاريخ النهاية لازم يكون بعد تاريخ البداية.");
      return;
    }
    body.startAt = startIso;
    body.endAt = endIso;
    setPending(true);
    try {
      const created = await apiRequest<{ id?: string }>("/api/admin/promotions", { method: "POST", body });
      setName("");
      setDescription("");
      setValue("");
      setStartAt("");
      setEndAt("");
      const id = created.data?.id;
      if (id) router.push(`/admin/promotions/${id}`);
      else router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نعمل العرض دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField label="اسم العرض" required hint="الاسم اللي هيظهر في صفحة العرض.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        )}
      </AdminField>

      <AdminField label="وصف مختصر" optional hint="سطرين توضح للعميل العرض إيه.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
          />
        )}
      </AdminField>

      <ChoiceField label="نوع الخصم" hint="نوع الخصم بيحدد إزاي بيتحسب.">
        <AdminChoices name="promotion-type" value={type} onChange={setType} options={TYPE_OPTIONS} />
      </ChoiceField>

      <ChoiceField
        label="على إيه بيتحسب"
        hint={lineOnly ? "نوع الخصم ده بيتحسب على المنتجات المختارة بس." : "اختار على إيه هيتحسب الخصم."}
      >
        <AdminChoices
          name="promotion-scope"
          value={effectiveScope}
          onChange={setScope}
          options={lineOnly ? SCOPE_OPTIONS.filter((option) => option.value === "LINE") : SCOPE_OPTIONS}
        />
      </ChoiceField>

      {valueField ? (
        <AdminField label={valueField.label} required hint={valueField.hint}>
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
      ) : (
        <p className="adm-hint">
          كمية الشراء وكمية المجاني والنسبة بتتحفظ في قاعدة «اشترِ واحصل» من صفحة العرض بعد ما العرض يتعمل.
        </p>
      )}

      <div className="adm-form-grid">
        <AdminField label="يبدأ في" optional hint="لو فاضي، العرض يبقى شغال من أول ما يتفعّل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          )}
        </AdminField>
        <AdminField label="ينتهي في" optional hint="لو فاضي، العرض مبيخلصش.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          )}
        </AdminField>
      </div>

      <FormError text={error} />
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          إنشاء العرض
        </AdminButton>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------- offer status */

export function PromotionStatusForm({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [next, setNext] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${id}`, { method: "PATCH", body: { status: next } });
      router.refresh();
    } catch (err) {
      setError(
        adminErrorMessage(
          err,
          "مش قادرين نغيّر حالة العرض. لو العرض على منتجات، لازم يكون مستهدف منتج واحد على الأقل.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <ChoiceField label="حالة العرض" hint="العرض في حالة مسودة مش بيشتغل على أي طلب.">
        <AdminChoices name="promotion-status" value={next} onChange={setNext} options={STATUS_OPTIONS} />
      </ChoiceField>
      <FormError text={error} />
      <div className="adm-btn-row">
        <AdminButton type="submit" size="sm" loading={pending}>
          حفظ حالة العرض
        </AdminButton>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------- offer targets */

export function TargetAddForm({ promotionId }: { promotionId: string }) {
  const router = useRouter();
  const [targetType, setTargetType] = useState("PRODUCT");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const raw = targetId.trim();
    if (!UUID_RE.test(raw)) {
      setError("الرقم الداخلي لازم يكون 36 خانة زي اللي موجود في صفحة المنتج أو التصنيف.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/targets`, {
        method: "POST",
        body: { targetType, targetId: raw },
      });
      setTargetId("");
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نضيف الاستهداف دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <ChoiceField label="نوع الحاجة المستهدفة" hint="العرض بيتطبّق على الحاجات من النوع ده.">
        <AdminChoices name="target-type" value={targetType} onChange={setTargetType} options={TARGET_OPTIONS} />
      </ChoiceField>
      <AdminField
        label="الرقم الداخلي"
        required
        hint="الصقه من صفحة المنتج أو التصنيف أو العلامة. الرقم الداخلي هو اللي بيحدد الحاجة بالظبط."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            dir="ltr"
            className="adm-cell-id"
          />
        )}
      </AdminField>
      <FormError text={error} />
      <div className="adm-btn-row">
        <AdminButton type="submit" size="sm" loading={pending}>
          إضافة الاستهداف
        </AdminButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- offer rules */

export function RulesPutForm({
  promotionId,
  initial,
}: {
  promotionId: string;
  /** The saved rules — the form starts from them, never from empty inputs. */
  initial?: {
    minimumQuantity?: string | null;
    minimumAmount?: string | null;
    maximumDiscount?: string | null;
  };
}) {
  const router = useRouter();
  const [minimumQuantity, setMinimumQuantity] = useState(initial?.minimumQuantity ?? "");
  const [minimumAmount, setMinimumAmount] = useState(initial?.minimumAmount ?? "");
  const [maximumDiscount, setMaximumDiscount] = useState(initial?.maximumDiscount ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    for (const [label, raw] of [
      ["أقل كمية", minimumQuantity],
      ["أقل قيمة طلب", minimumAmount],
      ["أقصى قيمة خصم", maximumDiscount],
    ] as const) {
      if (raw.trim() !== "" && !/^\d+(\.\d{1,3})?$/.test(raw.trim())) {
        setError(`${label} لازم تكون رقم موجب.`);
        return;
      }
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/rules`, {
        method: "PUT",
        body: {
          ...(minimumQuantity.trim() === "" ? {} : { minimumQuantity: minimumQuantity.trim() }),
          ...(minimumAmount.trim() === "" ? {} : { minimumAmount: minimumAmount.trim() }),
          ...(maximumDiscount.trim() === "" ? {} : { maximumDiscount: maximumDiscount.trim() }),
        },
      });
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نحفظ القواعد دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <div className="adm-form-grid">
        <AdminField label="أقل كمية" optional hint="أقل عدد قطع لازم يتطلب عشان الخصم يشتغل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={minimumQuantity}
              onChange={(e) => setMinimumQuantity(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
        <AdminField label="أقل قيمة طلب" optional hint="أقل مبلغ للطلب عشان الخصم يشتغل.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={minimumAmount}
              onChange={(e) => setMinimumAmount(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
        <AdminField label="أقصى قيمة خصم" optional hint="سقف للخصم بالجنيه، مهما كانت النسبة كبيرة.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={maximumDiscount}
              onChange={(e) => setMaximumDiscount(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
      </div>
      <FormError text={error} />
      <div className="adm-btn-row">
        <AdminButton type="submit" size="sm" loading={pending}>
          حفظ القواعد
        </AdminButton>
      </div>
    </form>
  );
}

/* -------------------------------------------------------- buy-get rule */

export function BuyGetPutForm({
  promotionId,
  initial,
}: {
  promotionId: string;
  /** The saved buy-get rule — the form starts from it, never from empty inputs. */
  initial?: {
    buyQuantity?: string | null;
    getQuantity?: string | null;
    discountPercent?: string | null;
    freeVariantId?: string | null;
  };
}) {
  const router = useRouter();
  const [buyQuantity, setBuyQuantity] = useState(initial?.buyQuantity ?? "");
  const [getQuantity, setGetQuantity] = useState(initial?.getQuantity ?? "");
  const [discountPercent, setDiscountPercent] = useState(initial?.discountPercent ?? "");
  const [freeVariantId, setFreeVariantId] = useState(initial?.freeVariantId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (buyQuantity.trim() === "" || getQuantity.trim() === "" || discountPercent.trim() === "") {
      setError("كمية الشراء وكمية المجاني ونسبة الخصم كلهم مطلوبين.");
      return;
    }
    if (!/^\d+(\.\d{1,3})?$/.test(buyQuantity.trim()) || !/^\d+(\.\d{1,3})?$/.test(getQuantity.trim())) {
      setError("الكميات لازم تكون أرقام موجبة.");
      return;
    }
    const percent = Number(discountPercent.trim());
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      setError("نسبة الخصم لازم تكون رقم أكبر من صفر ونهائيته 100.");
      return;
    }
    const free = freeVariantId.trim();
    if (free !== "" && !UUID_RE.test(free)) {
      setError("الرقم الداخلي للشكل المجاني لازم يكون 36 خانة.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/buy-get`, {
        method: "PUT",
        body: {
          buyQuantity: buyQuantity.trim(),
          getQuantity: getQuantity.trim(),
          discountPercent: discountPercent.trim(),
          ...(free === "" ? {} : { freeVariantId: free }),
        },
      });
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نحفظ قاعدة اشترِ واحصل. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="adm-form">
      <div className="adm-form-grid">
        <AdminField label="كمية الشراء" required hint="العميل لازم يشتري الكمية دي عشان ياخد الكمية التانية.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={buyQuantity}
              onChange={(e) => setBuyQuantity(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
        <AdminField label="كمية المجاني" required hint="الكمية اللي العميل بياخدها بسعر مخفّض.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={getQuantity}
              onChange={(e) => setGetQuantity(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
        <AdminField label="نسبة الخصم على الكمية التانية" required hint="رقم من 1 لحد 100.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              inputMode="decimal"
            />
          )}
        </AdminField>
      </div>
      <AdminField
        label="شكل بيع تاني للمجاني"
        optional
        hint="الصقه لو المجاني بيتباع بشكل مختلف. لو فاضي، المجاني هو نفس المنتج اللي العميل اشتراه."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={freeVariantId}
            onChange={(e) => setFreeVariantId(e.target.value)}
            dir="ltr"
            className="adm-cell-id"
          />
        )}
      </AdminField>
      <FormError text={error} />
      <div className="adm-btn-row">
        <AdminButton type="submit" size="sm" loading={pending}>
          حفظ قاعدة اشترِ واحصل
        </AdminButton>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ delete */

/** The delete control shared by the offer and the coupon screens. */
export function DangerDeleteButton({
  path,
  label,
  question,
  confirmLabel,
}: {
  path: string;
  label: string;
  question: string;
  confirmLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiRequest(path, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(
        adminErrorMessage(
          err,
          "مش قادرين نحذف. لو في طلبات استعملت الحاجة دي، هي مش هتتفسح.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="adm-cell-main">
      <ConfirmButton
        label={label}
        confirmLabel={confirmLabel}
        question={question}
        onConfirm={() => void run()}
        disabled={pending}
      />
      <FormError text={error} />
    </span>
  );
}
