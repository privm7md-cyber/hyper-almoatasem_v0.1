// Taxonomy islands ("use client"): categories and brands.
//
// Contracts (server guards in parentheses):
//   POST /api/admin/catalog/categories        (products.create)  body=categoryInputSchema
//   PATCH /api/admin/catalog/categories/[id]   (products.update)  body=categoryPatchSchema
//   POST /api/admin/catalog/brands            (products.create)  body=brandInputSchema
//   PATCH /api/admin/catalog/brands/[id]      (products.update)  body=brandPatchSchema
//
// Both PATCH schemas are strict: only the keys below are ever sent. `name`,
// `sortOrder` and `isActive` are optional-only in the patch contract, so a
// toggle sends `{ isActive }` and a rename sends `{ name }` — never a null for
// a non-nullable column.
//
// The edit form edits ONE selected row (a dropdown), not one form per row:
// the taxonomy list can hold hundreds of rows and a form-per-row layout is
// unusable at that size.
//
// There is no hard delete in the catalogue: the frozen database graph forbids
// removing a row that still has products, so "deleting" a category or a brand
// means DEACTIVATING it — it leaves the storefront and stays in the catalogue
// with its products.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import {
  AdminButton,
  ConfirmButton,
  AdminField,
  AdminInput,
  AdminSelect,
} from "@/components/admin/ui/controls";

function Feedback({ tone, children }: { tone: "success" | "danger"; children: React.ReactNode }) {
  return (
    <div className={`adm-note ${tone === "success" ? "adm-note--accent" : "adm-note--danger"}`} role="alert">
      <Info size={16} className="adm-note-icon" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** The shared picker of one row out of a long list. */
function RowPicker({
  label,
  rows,
  selectedId,
  onPick,
}: {
  label: string;
  rows: { id: string; name: string }[];
  selectedId: string;
  onPick: (id: string) => void;
}) {
  return (
    <AdminField label={label} hint="اسحب واختار العنصر اللي عايز تعدّله من القائمة.">
      {({ inputId, describedBy }) => (
        <AdminSelect
          inputId={inputId}
          describedBy={describedBy}
          value={selectedId}
          onChange={(e) => onPick(e.target.value)}
        >
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </AdminSelect>
      )}
    </AdminField>
  );
}

export interface TaxonomyRow {
  id: string;
  name: string;
  isActive: boolean;
  productCount?: number;
  parentId?: string | null;
}

/* ---------------------------------------------------------------- categories */

export function CategoryCreateForm({
  parents = [],
}: {
  parents?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (name.trim() === "") {
      setFeedback({ tone: "danger", text: "اسم التصنيف مطلوب." });
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/categories", {
        method: "POST",
        body: {
          name: name.trim(),
          ...(slug.trim() === "" ? {} : { slug: slug.trim() }),
          ...(parentId === "" ? {} : { parentId }),
        },
      });
      setFeedback({ tone: "success", text: "تم إنشاء التصنيف." });
      setName("");
      setSlug("");
      setParentId("");
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر إنشاء التصنيف — راجع الاسم وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField label="اسم التصنيف" required hint="الاسم اللي هيظهر للعميل في المتجر.">
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

      <AdminField
        label="المعرّف"
        optional
        hint="النص اللي بيظهر في رابط التصنيف — حروف صغيرة وشرطات بين الكلمات. سيبه فاضي والنظام هيشتقه من الاسم."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={140}
            dir="ltr"
          />
        )}
      </AdminField>

      {parents.length > 0 ? (
        <AdminField label="التصنيف الأب" optional hint="التصنيف الأب بيجمع التصنيفات الفرعية في قسم واحد.">
          {({ inputId, describedBy }) => (
            <AdminSelect
              inputId={inputId}
              describedBy={describedBy}
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">— بدون تصنيف أب —</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
            </AdminSelect>
          )}
        </AdminField>
      ) : null}

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          أضف التصنيف
        </AdminButton>
      </div>
    </form>
  );
}

export function CategoryEditForm({
  categories,
}: {
  categories: TaxonomyRow[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const selected = categories.find((row) => row.id === selectedId) ?? null;
  const [nextName, setNextName] = useState(selected?.name ?? "");
  const [nextActive, setNextActive] = useState(selected?.isActive ?? true);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  function pick(id: string) {
    setSelectedId(id);
    const row = categories.find((item) => item.id === id) ?? null;
    setNextName(row?.name ?? "");
    setNextActive(row?.isActive ?? true);
    setFeedback(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (selectedId === "") {
      setFeedback({ tone: "danger", text: "اختار التصنيف المراد تعديله." });
      return;
    }
    if (nextName.trim() === "") {
      setFeedback({ tone: "danger", text: "اسم التصنيف مطلوب." });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/categories/${selectedId}`, {
        method: "PATCH",
        body: { name: nextName.trim(), isActive: nextActive },
      });
      setFeedback({ tone: "success", text: "تم حفظ التصنيف." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر الحفظ — راجع الاسم وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  if (categories.length === 0) {
    return <p className="adm-hint">مفيش تصنيفات للتعديل.</p>;
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <RowPicker label="التصنيف" rows={categories} selectedId={selectedId} onPick={pick} />

      <AdminField label="الاسم" required hint="الاسم الجديد اللي هيظهر في المتجر.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={nextName}
            onChange={(e) => setNextName(e.target.value)}
            maxLength={120}
            required
          />
        )}
      </AdminField>

      <div className="adm-field">
        <span className="adm-label">الظهور في المتجر</span>
        <div className="adm-choices" role="radiogroup" aria-label="الظهور في المتجر">
          <label className="adm-choice" htmlFor="ce-active-yes">
            <input
              id="ce-active-yes"
              type="radio"
              name="isActive"
              checked={nextActive}
              onChange={() => setNextActive(true)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">معروض في المتجر</span>
            <span className="adm-choice-hint">العملاء يشوفوا القسم ويدخلوا عليه.</span>
          </label>
          <label className="adm-choice" htmlFor="ce-active-no">
            <input
              id="ce-active-no"
              type="radio"
              name="isActive"
              checked={!nextActive}
              onChange={() => setNextActive(false)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">مخفي من المتجر</span>
            <span className="adm-choice-hint">يفضل في الكتالوج بتاع الإدارة.</span>
          </label>
        </div>
      </div>

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ التصنيف
        </AdminButton>
      </div>
    </form>
  );
}

export function CategoryDeactivateForm({
  categories,
}: {
  categories: TaxonomyRow[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const selected = categories.find((row) => row.id === selectedId) ?? null;
  const count = selected?.productCount ?? 0;

  async function deactivate() {
    if (pending || selectedId === "") return;
    setFeedback(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/categories/${selectedId}`, {
        method: "PATCH",
        body: { isActive: false },
      });
      setFeedback({ tone: "success", text: "تم تعطيل التصنيف." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر تعطيل التصنيف — جرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  if (categories.length === 0) {
    return <p className="adm-hint">مفيش تصنيفات للتعطيل.</p>;
  }

  return (
    <div className="adm-form">
      <RowPicker
        label="التصنيف المراد تعطيله"
        rows={categories}
        selectedId={selectedId}
        onPick={(id) => {
          setSelectedId(id);
          setFeedback(null);
        }}
      />

      <ConfirmButton
        label="تعطيل التصنيف"
        confirmLabel="تعطيل التصنيف"
        question={
          count > 0
            ? `التصنيف ده فيه ${count} منتج. تعطيله هيخفي المنتجات دي من المتجر، بس هيفضلوا موجودين في الكتالوج. عايز تكمّل؟`
            : "التصنيف ده مفيهوش منتجات. تعطيله هيخفيه من المتجر بس. عايز تكمّل؟"
        }
        onConfirm={() => void deactivate()}
        disabled={pending}
      />

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- brands */

export function BrandCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (name.trim() === "") {
      setFeedback({ tone: "danger", text: "اسم العلامة التجارية مطلوب." });
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/brands", {
        method: "POST",
        body: {
          name: name.trim(),
          ...(slug.trim() === "" ? {} : { slug: slug.trim() }),
        },
      });
      setFeedback({ tone: "success", text: "تم إنشاء العلامة التجارية." });
      setName("");
      setSlug("");
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر إنشاء العلامة التجارية — راجع الاسم وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <AdminField label="اسم العلامة التجارية" required hint="اسم الشركة اللي بتعمل المنتجات.">
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

      <AdminField
        label="المعرّف"
        optional
        hint="النص اللي بيظهر في رابط العلامة — حروف صغيرة وشرطات بين الكلمات. سيبه فاضي والنظام هيشتقه من الاسم."
      >
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={140}
            dir="ltr"
          />
        )}
      </AdminField>

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          أضف العلامة التجارية
        </AdminButton>
      </div>
    </form>
  );
}

export function BrandEditForm({ brands }: { brands: TaxonomyRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(brands[0]?.id ?? "");
  const selected = brands.find((row) => row.id === selectedId) ?? null;
  const [nextName, setNextName] = useState(selected?.name ?? "");
  const [nextActive, setNextActive] = useState(selected?.isActive ?? true);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  function pick(id: string) {
    setSelectedId(id);
    const row = brands.find((item) => item.id === id) ?? null;
    setNextName(row?.name ?? "");
    setNextActive(row?.isActive ?? true);
    setFeedback(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFeedback(null);
    if (selectedId === "") {
      setFeedback({ tone: "danger", text: "اختار العلامة التجارية المراد تعديلها." });
      return;
    }
    if (nextName.trim() === "") {
      setFeedback({ tone: "danger", text: "اسم العلامة التجارية مطلوب." });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/brands/${selectedId}`, {
        method: "PATCH",
        body: { name: nextName.trim(), isActive: nextActive },
      });
      setFeedback({ tone: "success", text: "تم حفظ العلامة التجارية." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر الحفظ — راجع الاسم وجرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  if (brands.length === 0) {
    return <p className="adm-hint">مفيش علامات تجارية للتعديل.</p>;
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="adm-form">
      <RowPicker label="العلامة التجارية" rows={brands} selectedId={selectedId} onPick={pick} />

      <AdminField label="الاسم" required hint="الاسم الجديد اللي هيظهر للعميل.">
        {({ inputId, describedBy }) => (
          <AdminInput
            inputId={inputId}
            describedBy={describedBy}
            value={nextName}
            onChange={(e) => setNextName(e.target.value)}
            maxLength={120}
            required
          />
        )}
      </AdminField>

      <div className="adm-field">
        <span className="adm-label">الظهور في المتجر</span>
        <div className="adm-choices" role="radiogroup" aria-label="الظهور في المتجر">
          <label className="adm-choice" htmlFor="be-active-yes">
            <input
              id="be-active-yes"
              type="radio"
              name="isActive"
              checked={nextActive}
              onChange={() => setNextActive(true)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">معروضة في المتجر</span>
            <span className="adm-choice-hint">العملاء يشوفوا كل منتجات العلامة في مكان واحد.</span>
          </label>
          <label className="adm-choice" htmlFor="be-active-no">
            <input
              id="be-active-no"
              type="radio"
              name="isActive"
              checked={!nextActive}
              onChange={() => setNextActive(false)}
              className="adm-sr-input"
            />
            <span className="adm-choice-title">مخفية من المتجر</span>
            <span className="adm-choice-hint">تفضل في الكتالوج بتاع الإدارة.</span>
          </label>
        </div>
      </div>

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}

      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          احفظ العلامة التجارية
        </AdminButton>
      </div>
    </form>
  );
}

export function BrandDeactivateForm({ brands }: { brands: TaxonomyRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(brands[0]?.id ?? "");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const selected = brands.find((row) => row.id === selectedId) ?? null;
  const count = selected?.productCount ?? 0;

  async function deactivate() {
    if (pending || selectedId === "") return;
    setFeedback(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/brands/${selectedId}`, {
        method: "PATCH",
        body: { isActive: false },
      });
      setFeedback({ tone: "success", text: "تم تعطيل العلامة التجارية." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: adminErrorMessage(error, "تعذّر تعطيل العلامة التجارية — جرب تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  if (brands.length === 0) {
    return <p className="adm-hint">مفيش علامات تجارية للتعطيل.</p>;
  }

  return (
    <div className="adm-form">
      <RowPicker
        label="العلامة التجارية المراد تعطيلها"
        rows={brands}
        selectedId={selectedId}
        onPick={(id) => {
          setSelectedId(id);
          setFeedback(null);
        }}
      />

      <ConfirmButton
        label="تعطيل العلامة التجارية"
        confirmLabel="تعطيل العلامة التجارية"
        question={
          count > 0
            ? `العلامة دي فيها ${count} منتج. تعطيلها هتخفي المنتجات دي من المتجر، بس هتفضل موجودة في الكتالوج. عايز تكمّل؟`
            : "العلامة دي مفيهاش منتجات. تعطيلها هتخفيها من المتجر بس. عايز تكمّل؟"
        }
        onConfirm={() => void deactivate()}
        disabled={pending}
      />

      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}
