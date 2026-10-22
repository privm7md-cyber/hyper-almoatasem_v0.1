// Phase-10 customer edit island ("use client").
//
// Contract: PATCH /api/admin/customers/[id] (server guard `customers.view` —
// the closest-capability mapping the route contract uses; there is no
// `customers.manage` key in the permission registry).
// Body shape = `customerPatchSchema` (strict): { firstName?, lastName?, email?,
// autoAcceptReplacements?, isActive? }.
//
// The phone number is NOT editable: the patch contract does not accept it and
// the storefront identifies the customer by phone.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CustomerEditForm({
  customerId,
  firstName,
  lastName,
  email,
  autoAcceptReplacements,
  isActive,
}: {
  customerId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  autoAcceptReplacements: boolean;
  isActive: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [nextFirstName, setNextFirstName] = useState(firstName);
  const [nextLastName, setNextLastName] = useState(lastName ?? "");
  const [nextEmail, setNextEmail] = useState(email ?? "");
  const [nextAutoAccept, setNextAutoAccept] = useState(autoAcceptReplacements);
  const [nextActive, setNextActive] = useState(isActive);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (nextFirstName.trim() === "") {
      setNote("الاسم الأول مطلوب.");
      return;
    }
    if (nextEmail.trim() !== "" && !nextEmail.trim().includes("@")) {
      setNote("البريد الإلكتروني غير صالح.");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/customers/${customerId}`, {
        method: "PATCH",
        body: {
          firstName: nextFirstName.trim(),
          lastName: nextLastName.trim() === "" ? null : nextLastName.trim(),
          email: nextEmail.trim() === "" ? null : nextEmail.trim(),
          autoAcceptReplacements: nextAutoAccept,
          isActive: nextActive,
        },
      });
      notify("success", "تم حفظ بيانات العميل.");
      router.refresh();
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الحفظ."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          الاسم الأول
          <input value={nextFirstName} onChange={(e) => setNextFirstName(e.target.value)} maxLength={80} required className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          الاسم الأخير
          <input value={nextLastName} onChange={(e) => setNextLastName(e.target.value)} maxLength={80} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        البريد الإلكتروني
        <input value={nextEmail} onChange={(e) => setNextEmail(e.target.value)} maxLength={160} dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextAutoAccept} onChange={(e) => setNextAutoAccept(e.target.checked)} className="h-5 w-5" />
        قبول البدائل تلقائيًا
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={nextActive} onChange={(e) => setNextActive(e.target.checked)} className="h-5 w-5" />
        نشط
      </label>
      {note ? (
        <p role="alert" className="text-sm text-error">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        حفظ بيانات العميل
      </Button>
    </form>
  );
}
