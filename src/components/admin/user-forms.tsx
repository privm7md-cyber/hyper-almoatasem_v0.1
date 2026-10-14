// FE-10F user create island ("use client"): name + email + optional phone.
// Server validates shapes + enforces users.manage + audit pairing.

"use client";

import { useState } from "react";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function UserCreateForm() {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (name.trim() === "" || email.trim() === "") {
      setNote("الاسم والبريد مطلوبان.");
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/admin/users", {
        method: "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() === "" ? {} : { phone: phone.trim() }),
        },
      });
      notify("success", "تم إنشاء المستخدم.");
      setName("");
      setEmail("");
      setPhone("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر الإنشاء."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[520px] gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          البريد
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" maxLength={160} className="min-h-[44px] rounded-control border border-line bg-white px-2" />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        الهاتف (اختياري، 8–15 رقمًا)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" dir="ltr" className="min-h-[44px] rounded-control border border-line bg-white px-2" />
      </label>
      {note ? (
        <p role="alert" className="text-sm text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        إنشاء المستخدم
      </Button>
    </form>
  );
}
