"use client";

import { useState } from "react";
import type { MediaShape } from "@/lib/catalog/serialize";
import { imageInputSchema, imagePatchSchema } from "@/lib/catalog/validation";
import { useAdminMutation, AdminMutationNote } from "@/components/admin/admin-mutate";
import { AdminButton, AdminDrawer, AdminField, AdminInput, AdminSelect, ConfirmButton } from "@/components/admin/ui/controls";

const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
const INT_MAX = 2147483647;
const numericLabels = { byteSize: "حجم الصورة بالبايت", width: "العرض بالبكسل", height: "الارتفاع بالبكسل", sortOrder: "ترتيب الصورة" } as const;
type NumericKey = keyof typeof numericLabels;

function integer(text: string, positive: boolean): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value > INT_MAX || value < (positive ? 1 : -INT_MAX - 1)) return NaN;
  return value;
}

export function ProductImageManager({ productId, images, canUpdate, canDelete }: {
  productId: string; images: MediaShape[]; canUpdate: boolean; canDelete: boolean;
}) {
  const ordered = [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return <div className="adm-form">
    <p className="adm-hint">دي إدارة بيانات صور بروابط HTTPS موجودة بالفعل. رفع الملفات وتخزين الصور غير متاحين؛ مفيش اختيار ملف محلي أو رفع صور هنا. بيانات الحجم والنوع والأبعاد بتتسجل كما تقدمها، من غير تحميل أو فحص الملف.</p>
    {ordered.length === 0 ? <p>مفيش صور مسجلة للمنتج ده.</p> : <ol aria-label="صور المنتج بالترتيب" className="adm-form">
      {ordered.map((image) => <li key={`${image.id}-${image.altText}-${image.sortOrder}-${image.isPrimary}`}>
        <ImageMetadata image={image} canUpdate={canUpdate} canDelete={canDelete} />
      </li>)}
    </ol>}
    {canUpdate ? <RegisterImageForm productId={productId} /> : <p className="adm-hint">تسجيل الصور وتعديل بياناتها محتاج صلاحية تعديل المنتجات.</p>}
  </div>;
}

function RegisterImageForm({ productId }: { productId: string }) {
  const [url, setUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [numbers, setNumbers] = useState<Record<NumericKey, string>>({ byteSize: "", width: "", height: "", sortOrder: "0" });
  const [isPrimary, setPrimary] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useAdminMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = { url: url.trim(), altText: altText.trim(), ...(mimeType ? { mimeType } : {}),
      ...Object.fromEntries((Object.keys(numericLabels) as NumericKey[]).filter((key) => numbers[key].trim() !== "").map((key) => [key, integer(numbers[key], key !== "sortOrder")])), isPrimary };
    const parsed = imageInputSchema.safeParse(body);
    const nextErrors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] = issue.path[0] === "url" ? "اكتب رابط HTTPS كامل وصالح لصورة موجودة." : "راجع القيمة: الأعداد صحيحة، والحجم والأبعاد موجبة، والنوع من القائمة.";
    if (/\s/.test(body.url)) nextErrors.url = "رابط الصورة لازم يكون من غير مسافات.";
    if (altText.trim().length > 200) nextErrors.altText = "الوصف لا يزيد عن ٢٠٠ حرف.";
    if ((numbers.width.trim() === "") !== (numbers.height.trim() === "")) { nextErrors.width = "اكتب العرض والارتفاع مع بعض، أو اترك الاتنين فاضيين."; nextErrors.height = nextErrors.width; }
    setErrors(nextErrors);
    if (!parsed.success || Object.keys(nextErrors).length) return;
    const data = await mutation.mutate<MediaShape>(`/api/admin/catalog/products/${productId}/images`, { method: "POST", body: parsed.data }, "تم تسجيل بيانات الصورة. لم يتم رفع ملف.");
    if (data) { setUrl(""); setAltText(""); setMimeType(""); setNumbers({ byteSize: "", width: "", height: "", sortOrder: "0" }); setPrimary(false); }
  }

  return <form aria-label="تسجيل رابط صورة" className="adm-form" onSubmit={(event) => void submit(event)} noValidate>
    <h3 className="adm-section-title">تسجيل رابط صورة موجودة</h3>
    <AdminField label="رابط الصورة HTTPS" required error={errors.url}>
      {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} invalid={!!errors.url} type="url" dir="ltr" value={url} maxLength={2000} disabled={mutation.pending} onChange={(event) => setUrl(event.target.value)} />}
    </AdminField>
    <AdminField label="وصف الصورة" optional error={errors.altText}>
      {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} invalid={!!errors.altText} value={altText} maxLength={200} disabled={mutation.pending} onChange={(event) => setAltText(event.target.value)} />}
    </AdminField>
    <div className="adm-form-grid">
      <AdminField label="نوع ملف الصورة" optional error={errors.mimeType}>
        {({ inputId, describedBy }) => <AdminSelect inputId={inputId} describedBy={describedBy} invalid={!!errors.mimeType} value={mimeType} disabled={mutation.pending} onChange={(event) => setMimeType(event.target.value)}><option value="">غير مسجل</option>{MIME_TYPES.map((mime) => <option key={mime} value={mime}>{mime}</option>)}</AdminSelect>}
      </AdminField>
      {(Object.keys(numericLabels) as NumericKey[]).map((key) => <AdminField key={key} label={numericLabels[key]} optional={key !== "sortOrder"} error={errors[key]}>
        {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} invalid={!!errors[key]} type="number" step="1" min={key === "sortOrder" ? -INT_MAX - 1 : 1} max={INT_MAX} value={numbers[key]} disabled={mutation.pending} onChange={(event) => setNumbers({ ...numbers, [key]: event.target.value })} />}
      </AdminField>)}
    </div>
    <label className="adm-label"><input type="checkbox" checked={isPrimary} disabled={mutation.pending} onChange={(event) => setPrimary(event.target.checked)} /> اجعل الصورة أساسية</label>
    <AdminMutationNote note={mutation.note} />
    <AdminButton type="submit" loading={mutation.pending}>سجّل بيانات الصورة</AdminButton>
  </form>;
}

function ImageMetadata({ image, canUpdate, canDelete }: { image: MediaShape; canUpdate: boolean; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [altText, setAltText] = useState(image.altText ?? "");
  const [sortOrder, setSortOrder] = useState(String(image.sortOrder));
  const [isPrimary, setPrimary] = useState(image.isPrimary);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useAdminMutation();
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = imagePatchSchema.safeParse({ altText: altText.trim(), sortOrder: integer(sortOrder, false), isPrimary });
    const nextErrors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] = "راجع الوصف (٢٠٠ حرف بحد أقصى) والترتيب (عدد صحيح).";
    if (sortOrder.trim() === "") nextErrors.sortOrder = "اكتب ترتيب الصورة كعدد صحيح.";
    setErrors(nextErrors);
    if (!parsed.success || Object.keys(nextErrors).length) return;
    const data = await mutation.mutate<MediaShape>(`/api/admin/catalog/images/${image.id}`, { method: "PATCH", body: parsed.data }, "تم حفظ وصف الصورة وترتيبها وحالتها الأساسية.");
    if (data) setOpen(false);
  }
  async function remove() {
    const data = await mutation.mutate<{ deleted: boolean }>(`/api/admin/catalog/images/${image.id}`, { method: "DELETE" }, "تم حذف بيانات الصورة فقط. الملف الخارجي لم يُحذف.");
    if (data?.deleted) setRemoved(true);
  }
  return <div className="adm-form">
    {!removed ? <>
      {failed ? <p role="status">تعذّر عرض الصورة من الرابط. بياناتها ما زالت مسجلة.</p> : (
        // Direct metadata reference, not an optimizer/storage proxy (same as catalog cards).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt={image.altText ?? "صورة المنتج"} loading="lazy" width={160} className="adm-media-thumb-img" onError={() => setFailed(true)} />
      )}
      <p>الترتيب: {image.sortOrder} — {image.isPrimary ? "صورة أساسية" : "صورة إضافية"}</p>
      <p className="adm-hint">النوع: {image.mimeType ?? "غير مسجل"} — الحجم بالبايت: {image.byteSize ?? "غير مسجل"} — الأبعاد: {image.width !== null && image.height !== null ? `${image.width} × ${image.height}` : "غير مسجلة"}</p>
      <a href={image.url} target="_blank" rel="noopener noreferrer" dir="ltr">{image.url}</a>
      <div className="adm-btn-row">
        {canUpdate ? <AdminButton variant="secondary" disabled={mutation.pending} onClick={() => setOpen(true)}>تعديل بيانات الصورة</AdminButton> : null}
        {canDelete ? <ConfirmButton label="حذف بيانات الصورة" confirmLabel="تأكيد حذف البيانات فقط" question="حذف مرجع الصورة من المنتج؟ دي إزالة بيانات فقط، مش حذف الملف من التخزين الخارجي." disabled={mutation.pending} onConfirm={() => void remove()} /> : null}
      </div>
    </> : null}
    {!open ? <AdminMutationNote note={mutation.note} /> : null}
    <AdminDrawer open={open} title="تعديل بيانات الصورة" onClose={() => { if (!mutation.pending) setOpen(false); }}>
      <form className="adm-form" aria-label="تعديل بيانات الصورة" onSubmit={(event) => void save(event)} noValidate>
        <AdminField label="وصف الصورة" error={errors.altText}>
          {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} invalid={!!errors.altText} value={altText} maxLength={200} disabled={mutation.pending} onChange={(event) => setAltText(event.target.value)} />}
        </AdminField>
        <AdminField label="ترتيب الصورة" error={errors.sortOrder}>
          {({ inputId, describedBy }) => <AdminInput inputId={inputId} describedBy={describedBy} invalid={!!errors.sortOrder} type="number" step="1" value={sortOrder} disabled={mutation.pending} onChange={(event) => setSortOrder(event.target.value)} />}
        </AdminField>
        <label className="adm-label"><input type="checkbox" checked={isPrimary} disabled={mutation.pending} onChange={(event) => setPrimary(event.target.checked)} /> الصورة الأساسية</label>
        {!mutation.note?.ok ? <AdminMutationNote note={mutation.note} /> : null}
        <AdminButton type="submit" loading={mutation.pending}>احفظ بيانات الصورة</AdminButton>
      </form>
    </AdminDrawer>
  </div>;
}
