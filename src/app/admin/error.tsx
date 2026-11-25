// Isolate admin failures without revealing internals or asserting whether a
// pending write succeeded. Auth gates (redirect/403) are not errors.

"use client";

import { AdminButton } from "@/components/admin/ui/controls";

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <div className="adm-empty adm-empty--danger" role="alert">
      <p className="adm-empty-title">تعذّر عرض هذه الصفحة في لوحة الإدارة</p>
      <p className="adm-empty-hint">
        تعذّر عرض الصفحة. جرّب تحميلها تاني. لو كنت بتنفّذ إجراء، راجع حالته قبل تكراره؛
        مش ممكن نتأكد من نتيجته من الشاشة دي.
      </p>
      <div className="adm-btn-row">
        <AdminButton variant="primary" onClick={reset}>
          جرّب تاني
        </AdminButton>
      </div>
    </div>
  );
}
