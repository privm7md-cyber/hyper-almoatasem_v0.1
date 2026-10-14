// FE-6 address book island ("use client"): list + create + set-default + delete.
// Ownership is server-enforced (session scope); 404 masks foreign rows (never leaks
// existence). No governorate field (contract); city + phone required.

"use client";

import { useState } from "react";
import { AppError, apiRequest } from "@/lib/frontend/api-client";
import { Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import type { ViewerAddress } from "@/lib/frontend/account-reads";

const EMPTY_FORM = {
  label: "",
  city: "",
  area: "",
  village: "",
  street: "",
  buildingNumber: "",
  landmark: "",
  phone: "",
  isDefault: false,
};

export function AddressBook({ initial }: { initial: ViewerAddress[] }) {
  const [items, setItems] = useState<ViewerAddress[]>(initial);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function reload() {
    const res = await apiRequest<{ addresses: ViewerAddress[] }>("/api/store/customers/addresses");
    // GET addresses returns ok(rows) → data IS the array; normalize defensively.
    const rows = res.data as unknown;
    if (Array.isArray(rows)) setItems(rows as ViewerAddress[]);
    else if (rows !== null && typeof rows === "object" && Array.isArray((rows as { addresses?: unknown }).addresses)) {
      setItems((rows as { addresses: ViewerAddress[] }).addresses);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (form.city.trim() === "" || form.phone.trim() === "") {
      setError("المدينة ورقم الهاتف مطلوبان.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/store/customers/addresses", {
        method: "POST",
        body: {
          ...(form.label.trim() === "" ? {} : { label: form.label.trim() }),
          city: form.city.trim(),
          ...(form.area.trim() === "" ? {} : { area: form.area.trim() }),
          ...(form.village.trim() === "" ? {} : { village: form.village.trim() }),
          ...(form.street.trim() === "" ? {} : { street: form.street.trim() }),
          ...(form.buildingNumber.trim() === "" ? {} : { buildingNumber: form.buildingNumber.trim() }),
          ...(form.landmark.trim() === "" ? {} : { landmark: form.landmark.trim() }),
          phone: form.phone.trim(),
          ...(form.isDefault ? { isDefault: true } : {}),
        },
      });
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      setError(err instanceof AppError ? err.message : "تعذّر حفظ العنوان.");
    } finally {
      setPending(false);
    }
  }

  async function setDefault(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/store/customers/addresses/${id}`, {
        method: "PATCH",
        body: { isDefault: true },
      });
      await reload();
    } catch (err) {
      setError(err instanceof AppError ? err.message : "تعذّر تعيين الافتراضي.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/store/customers/addresses/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof AppError ? err.message : "تعذّر حذف العنوان.");
    }
  }

  return (
    <div className="grid gap-4">
      {items.length === 0 ? (
        <EmptyState title="لا توجد عناوين محفوظة" hint="أضف عنوانك الأول أدناه." />
      ) : (
        <ul className="grid gap-3">
          {items.map((a) => (
            <li key={a.id} className="rounded-card border border-line bg-white p-3">
              <p className="font-bold">
                {a.label ?? a.city}
                {a.isDefault ? <span className="ms-2 text-sm text-success">(افتراضي)</span> : null}
              </p>
              <p className="text-sm text-secondary">
                {[a.city, a.area, a.village, a.street, a.buildingNumber, a.landmark]
                  .filter((x) => x !== null && x !== "")
                  .join("، ")}
              </p>
              <p className="text-sm">
                <bdi>{a.phone}</bdi>
              </p>
              <div className="mt-2 flex gap-2">
                {!a.isDefault ? (
                  <Button variant="secondary" size="sm" onClick={() => void setDefault(a.id)}>
                    تعيين افتراضي
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => void remove(a.id)}>
                  حذف
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      <form onSubmit={(e) => void create(e)} className="grid max-w-[480px] gap-3 rounded-card border border-line bg-white p-4">
        <p className="font-bold">عنوان جديد</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="المدينة">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.city} onChange={(e) => set("city", e.target.value)} />
            )}
          </Field>
          <Field label="الهاتف">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            )}
          </Field>
          <Field label="تسمية (اختياري)">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.label} onChange={(e) => set("label", e.target.value)} />
            )}
          </Field>
          <Field label="الحي (اختياري)">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.area} onChange={(e) => set("area", e.target.value)} />
            )}
          </Field>
          <Field label="القرية (اختياري)">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.village} onChange={(e) => set("village", e.target.value)} />
            )}
          </Field>
          <Field label="الشارع (اختياري)">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.street} onChange={(e) => set("street", e.target.value)} />
            )}
          </Field>
          <Field label="رقم المبنى (اختياري)">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.buildingNumber} onChange={(e) => set("buildingNumber", e.target.value)} />
            )}
          </Field>
          <Field label="علامة مميزة (اختياري)">
            {({ inputId, describedBy }) => (
              <TextInput inputId={inputId} describedBy={describedBy} value={form.landmark} onChange={(e) => set("landmark", e.target.value)} />
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => set("isDefault", e.target.checked)}
            className="h-5 w-5"
          />
          تعيين كافتراضي
        </label>
        <Button type="submit" loading={pending}>
          حفظ العنوان
        </Button>
      </form>
    </div>
  );
}
