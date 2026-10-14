// FE-12 admin segment error boundary: isolates admin failures from the storefront.
// Same honesty contract as the root boundary — shared ErrorState, safe reset,
// no internals/secrets (digest is opaque). Admin auth gates (redirect/403) are
// NOT errors and never reach this boundary.

"use client";

import { ErrorState } from "@/components/ui/states";

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center p-6">
      <ErrorState
        title="حدث خطأ في لوحة الإدارة"
        text="حاول إعادة المحاولة. لم تُفقد بيانات — لم يُرسل أي إجراء."
        onRetry={reset}
      />
    </main>
  );
}
