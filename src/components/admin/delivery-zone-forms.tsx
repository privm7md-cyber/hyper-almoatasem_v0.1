// DELIVERY ZONE ISLANDS ("use client"): create, edit, stop and restart.
//
// The server owns the matching key, the fee shape and the optimistic
// concurrency check: an edit carries the row version it read, so a stale tab
// gets a conflict instead of overwriting the other editor.
//
// "Stopping" a zone is the only lifecycle the API offers (there is no delete
// route), so the confirmation says exactly that: the row stays in the list and
// the orders fall back to the default delivery fee.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import type { DeliveryScope } from "@/lib/orders/delivery-scope";
import {
  AdminButton,
  AdminChoices,
  AdminDrawer,
  AdminField,
  AdminInput,
} from "@/components/admin/ui/controls";

type NoteTone = "ok" | "bad";

export interface DeliveryZoneView {
  scope?:DeliveryScope|null;
  id: string;
  name: string;
  normalizedName: string;
  fee: string;
  isActive: boolean;
  version: number;
}

/** The server prices money the same way: a number with at most two decimals. */
const FEE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
const FEE_ERROR = "اكتب الرسوم رقم من صفر لفوق وبحد أقصى منزلتين عشريتين، زي 20 أو 20.50.";

function InlineNote({ tone, children }: { tone: NoteTone; children: React.ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={tone === "bad" ? "adm-note adm-note--danger" : "adm-note adm-note--accent"}
    >
      <div>{children}</div>
    </div>
  );
}

export function DeliveryZoneCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [city,setCity]=useState("");
  const [field,setField]=useState<DeliveryScope["field"]>("area");
  const [eligible,setEligible]=useState(true);
  const [fee, setFee] = useState("");
  const [isActive, setIsActive] = useState("true");
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "" || city.trim()==="") {
      setNote({ tone: "bad", text: "اسم المنطقة والمدينة / المركز مطلوبان." });
      return;
    }
    if (!FEE_PATTERN.test(fee.trim())) {
      setNote({ tone: "bad", text: FEE_ERROR });
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/delivery-zones", {
        method: "POST",
        body: { name: name.trim(), fee: fee.trim(), isActive: isActive === "true",scope:{city:city.trim(),locality:field==="city" ? city.trim() : name.trim(),field,eligible} },
      });
      setName("");
      setCity("");
      setFee("");
      setIsActive("true");
      setNote({ tone: "ok", text: "تمت إضافة منطقة التوصيل." });
      router.refresh();
    } catch (error) {
      setNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نضيف المنطقة دلوقتي. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="adm-form">
      <div className="adm-form-grid">
        <ScopeFields city={city} setCity={setCity} field={field} setField={setField} eligible={eligible} setEligible={setEligible} />
        <AdminField
          label="اسم المنطقة"
          required
          hint="اسم المنطقة أو القرية داخل المدينة المحددة. المطابقة صريحة بعد توحيد الكتابة."
        >
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              required
            />
          )}
        </AdminField>
        <AdminField label="رسوم التوصيل" required hint="بالجنيه المصري.">
          {({ inputId, describedBy }) => (
            <AdminInput
              inputId={inputId}
              describedBy={describedBy}
              value={fee}
              onChange={(event) => setFee(event.target.value)}
              inputMode="decimal"
              dir="ltr"
            />
          )}
        </AdminField>
        <AdminField label="حالة المنطقة" hint="المنطقة الموقوفة مش بتتحسب للطلبات الجديدة.">
          {() => (
            <AdminChoices
              name="delivery-zone-new-active"
              value={isActive}
              onChange={setIsActive}
              options={[
                { value: "true", title: "مفعّلة", hint: "المنطقة شغالة في التسعير" },
                { value: "false", title: "موقوفة", hint: "محفوظة بس مش متحتسبة" },
              ]}
            />
          )}
        </AdminField>
      </div>
      {note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}
      <div className="adm-btn-row">
        <AdminButton type="submit" loading={pending}>
          أضف المنطقة
        </AdminButton>
      </div>
    </form>
  );
}

/** The row's own controls: edit in a drawer, and stop or restart the zone. */
export function DeliveryZoneActions({
  zone,
  canManage,
}: {
  zone: DeliveryZoneView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(zone.name);
  const [city,setCity]=useState(zone.scope?.city ?? "");
  const [field,setField]=useState<DeliveryScope["field"]>(zone.scope?.field ?? "area");
  const [eligible,setEligible]=useState(zone.scope?.eligible ?? true);
  const [fee, setFee] = useState(zone.fee);
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [formNote, setFormNote] = useState<{ tone: NoteTone; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormNote(null);
    if (name.trim() === "") {
      setFormNote({ tone: "bad", text: "اسم المنطقة مطلوب." });
      return;
    }
    if (!FEE_PATTERN.test(fee.trim())) {
      setFormNote({ tone: "bad", text: FEE_ERROR });
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/delivery-zones/${zone.id}`, {
        method: "PATCH",
        body: { name: name.trim(), fee: fee.trim(), version: zone.version,
          ...(city.trim() ? {scope:{city:city.trim(),locality:field==="city" ? city.trim() : name.trim(),field,eligible}} : {}) },
      });
      setEditing(false);
      setNote({ tone: "ok", text: "تم حفظ التعديلات على المنطقة." });
      router.refresh();
    } catch (error) {
      setFormNote({ tone: "bad", text: adminErrorMessage(error, "مش قادرين نحفظ التعديلات. حاول تاني.") });
    } finally {
      setPending(false);
    }
  }

  async function setActive(nextActive: boolean) {
    if (pending) return;
    setNote(null);
    setPending(true);
    try {
      await apiRequest(`/api/admin/delivery-zones/${zone.id}`, {
        method: "PATCH",
        body: { isActive: nextActive, version: zone.version },
      });
      setConfirming(false);
      setNote({
        tone: "ok",
        text: nextActive ? "تم تفعيل المنطقة وفق أهلية التوصيل المحددة." : "اتوقفت المنطقة. المناطق المرتبطة بمدينة ترفض الطلبات الجديدة حتى إعادة تفعيلها.",
      });
      router.refresh();
    } catch (error) {
      setNote({
        tone: "bad",
        text: adminErrorMessage(error, "مش قادرين نغيّر حالة المنطقة. حدّث الصفحة وحاول تاني."),
      });
    } finally {
      setPending(false);
    }
  }

  if (!canManage) {
    return <span className="adm-hint">الحساب ده بيقدر يشوف بس</span>;
  }

  return (
    <div className="adm-form">
      <div className="adm-btn-row">
        <AdminButton variant="secondary" size="sm" onClick={() => setEditing(true)}>
          تعديل
        </AdminButton>
        {zone.isActive ? (
          <AdminButton variant="danger" size="sm" onClick={() => setConfirming(true)}>
            إيقاف المنطقة
          </AdminButton>
        ) : (
          <AdminButton variant="secondary" size="sm" loading={pending} onClick={() => void setActive(true)}>
            تفعيل المنطقة
          </AdminButton>
        )}
      </div>

      {confirming ? (
        <div className="adm-note adm-note--danger" role="alert">
          <div>
            هتوقف منطقة «{zone.name}». {zone.scope ? "الطلبات الجديدة في المنطقة دي هتترفض." : "المنطقة القديمة غير المرتبطة بمدينة ستتبع سياسة الرسوم الافتراضية."} المنطقة هتفضل محفوظة في القائمة ويمكن إعادة تفعيلها لاحقًا.
          </div>
          <div className="adm-btn-row">
            <AdminButton variant="danger" size="sm" loading={pending} onClick={() => void setActive(false)}>
              تأكيد الإيقاف
            </AdminButton>
            <AdminButton variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              تراجع
            </AdminButton>
          </div>
        </div>
      ) : null}

      {note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}

      <AdminDrawer open={editing} title={`تعديل منطقة «${zone.name}»`} onClose={() => setEditing(false)}>
        <form onSubmit={(event) => void save(event)} className="adm-form">
          <ScopeFields city={city} setCity={setCity} field={field} setField={setField} eligible={eligible} setEligible={setEligible} />
          <AdminField label="اسم المنطقة" required>
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={32}
                required
              />
            )}
          </AdminField>
          <AdminField label="رسوم التوصيل" required hint="بالجنيه المصري.">
            {({ inputId, describedBy }) => (
              <AdminInput
                inputId={inputId}
                describedBy={describedBy}
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                inputMode="decimal"
                dir="ltr"
              />
            )}
          </AdminField>
          {formNote ? <InlineNote tone={formNote.tone}>{formNote.text}</InlineNote> : null}
          <div className="adm-btn-row">
            <AdminButton type="submit" loading={pending}>
              احفظ التعديلات
            </AdminButton>
            <AdminButton variant="ghost" onClick={() => setEditing(false)}>
              رجوع
            </AdminButton>
          </div>
        </form>
      </AdminDrawer>
    </div>
  );
}

function ScopeFields({city,setCity,field,setField,eligible,setEligible}:{city:string;setCity:(v:string)=>void;field:DeliveryScope["field"];setField:(v:DeliveryScope["field"])=>void;eligible:boolean;setEligible:(v:boolean)=>void}) {
  return <>
    <label>المدينة / المركز<input className="adm-input" value={city} onChange={e=>setCity(e.target.value)} maxLength={32} required /></label>
    <label>نوع النطاق<select className="adm-select" value={field} onChange={e=>setField(e.target.value as DeliveryScope["field"])}><option value="area">منطقة داخل المدينة</option><option value="village">قرية داخل المركز</option><option value="city">المدينة / المركز بالكامل</option></select></label>
    <label><input type="checkbox" checked={eligible} onChange={e=>setEligible(e.target.checked)} />العنوان مؤهل للتوصيل</label>
  </>;
}
