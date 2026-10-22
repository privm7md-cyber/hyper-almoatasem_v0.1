// FE-10F customer register island ("use client"): admin-assisted password provisioning
// for guest→registered conversion (POST customers/[id]/register). Server owns policy + audit.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, displayFailure } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CustomerRegisterForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setNote(null);
    if (password.length < 1) {
      setNote("أدخل كلمة المرور (السياسة 12..128 تُفرض على الخادم).");
      return;
    }
    setPending(true);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/register`, {
        method: "POST",
        body: { password },
      });
      notify("success", "تم تسجيل العميل.");
      router.refresh();
      setPassword("");
    } catch (error) {
      setNote(displayFailure(error, "تعذّر التسجيل."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-[420px] gap-3">
      <label className="grid gap-1 text-sm font-semibold">
        كلمة المرور الجديدة
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="min-h-[44px] rounded-control border border-line bg-white px-2"
        />
      </label>
      {note ? (
        <p role="alert" className="text-sm text-secondary">
          {note}
        </p>
      ) : null}
      <Button type="submit" loading={pending} variant="secondary">
        تسجيل العميل
      </Button>
    </form>
  );
}
