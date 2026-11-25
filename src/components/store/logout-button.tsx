// FE-6 logout button ("use client"): DELETE session → local UI reset → home.
// Server revocation + cookie clearing happen in the endpoint; no local secret to wipe.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/frontend/api-client";
import { Button } from "@/components/ui/button";
import { notifyCartCount } from "@/components/store/cart-badge";
import { resetCartStore } from "@/lib/frontend/cart-lines-store";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await apiRequest("/api/store/customers/session", { method: "DELETE" });
    } catch {
      // Logout is best-effort client-side; the session cookie is server-cleared on success.
    } finally {
      // Clear customer cart cache and in-memory lines on logout so no stale count survives
      notifyCartCount(0);
      resetCartStore();
      router.push("/");
      router.refresh();
    }
  }
  return (
    <Button variant="secondary" disabled={pending} onClick={() => void logout()}>
      تسجيل الخروج
    </Button>
  );
}
