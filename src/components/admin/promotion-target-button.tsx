// ADM-07 — add one catalogue item as an offer target (client island).
//
// The write goes to the backend target endpoint, which validates that the
// target exists and is alive; the island only reports what the server said.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { AdminButton } from "@/components/admin/ui/controls";

export function AddPromotionTargetButton({
  promotionId,
  targetType,
  targetId,
  label,
}: {
  promotionId: string;
  targetType: "PRODUCT" | "VARIANT" | "BRAND" | "CATEGORY";
  targetId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/admin/promotions/${promotionId}/targets`, {
        method: "POST",
        body: { targetType, targetId },
      });
      router.refresh();
    } catch (err) {
      setError(adminErrorMessage(err, "مش قادرين نضيف المنتج للعرض دلوقتي. جرّب تاني."));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="adm-cell-main">
      <AdminButton type="button" size="sm" variant="secondary" onClick={() => void run()} loading={pending}>
        {label}
      </AdminButton>
      {error ? (
        <span role="alert" className="adm-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
