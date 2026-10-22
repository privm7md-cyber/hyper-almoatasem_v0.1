// Phase-10 catalog taxonomy islands ("use client"): categories + brands.
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

function Note({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-error">
      {text}
    </p>
  );
}

export function CategoryCreateForm() {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم التصنيف مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/categories", {
        method: "POST",
        body: { name: name.trim(), ...(slug.trim() === "" ? {} : { slug: slug.trim() }) },
      });
      notify("success", "تم إنشاء التصنيف.");
      setName("");
      setSlug("");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر إنشاء التصنيف."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        اسم التصنيف
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        المعرّف في الرابط (slug) — اختياري
        <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={140} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        إنشاء التصنيف
      </Button>
    </form>
  );
}

export function CategoryEditForm({
  categories,
}: {
  categories: { id: string; name: string; isActive: boolean }[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const selected = categories.find((c) => c.id === selectedId) ?? null;
  const [nextName, setNextName] = useState(selected?.name ?? "");
  const [nextActive, setNextActive] = useState(selected?.isActive ?? true);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function pick(id: string) {
    setSelectedId(id);
    const row = categories.find((c) => c.id === id) ?? null;
    setNextName(row?.name ?? "");
    setNextActive(row?.isActive ?? true);
    setNote(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (selectedId === "") {
      setNote("اختر التصنيف المراد تعديله.");
      return;
    }
    if (nextName.trim() === "") {
      setNote("اسم التصنيف مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/categories/${selectedId}`, {
        method: "PATCH",
        body: { name: nextName.trim(), isActive: nextActive },
      });
      notify("success", "تم حفظ التصنيف.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  if (categories.length === 0) {
    return <p className="text-sm text-secondary">لا توجد تصنيفات لتعديلها.</p>;
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        التصنيف
        <select value={selectedId} onChange={(e) => pick(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        الاسم
        <input value={nextName} onChange={(e) => setNextName(e.target.value)} maxLength={120} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextActive} onChange={(e) => setNextActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        حفظ التصنيف
      </Button>
    </form>
  );
}

export function BrandCreateForm() {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "") {
      setNote("اسم العلامة مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/catalog/brands", {
        method: "POST",
        body: { name: name.trim(), ...(slug.trim() === "" ? {} : { slug: slug.trim() }) },
      });
      notify("success", "تم إنشاء العلامة.");
      setName("");
      setSlug("");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر إنشاء العلامة."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        اسم العلامة
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        المعرّف في الرابط (slug) — اختياري
        <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={140} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        إنشاء العلامة
      </Button>
    </form>
  );
}

export function BrandEditForm({ brands }: { brands: { id: string; name: string; isActive: boolean }[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [selectedId, setSelectedId] = useState(brands[0]?.id ?? "");
  const selected = brands.find((b) => b.id === selectedId) ?? null;
  const [nextName, setNextName] = useState(selected?.name ?? "");
  const [nextActive, setNextActive] = useState(selected?.isActive ?? true);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function pick(id: string) {
    setSelectedId(id);
    const row = brands.find((b) => b.id === id) ?? null;
    setNextName(row?.name ?? "");
    setNextActive(row?.isActive ?? true);
    setNote(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (selectedId === "") {
      setNote("اختر العلامة المراد تعديلها.");
      return;
    }
    if (nextName.trim() === "") {
      setNote("اسم العلامة مطلوب.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/catalog/brands/${selectedId}`, {
        method: "PATCH",
        body: { name: nextName.trim(), isActive: nextActive },
      });
      notify("success", "تم حفظ العلامة.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  if (brands.length === 0) {
    return <p className="text-sm text-secondary">لا توجد علامات لتعديلها.</p>;
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[480px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        العلامة
        <select value={selectedId} onChange={(e) => pick(e.target.value)} className="min-h-[44px] rounded-control border border-line bg-white px-2">
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        الاسم
        <input value={nextName} onChange={(e) => setNextName(e.target.value)} maxLength={120} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextActive} onChange={(e) => setNextActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      <Note text={note} />
      <Button type="submit" loading={pending}>
        حفظ العلامة
      </Button>
    </form>
  );
}
