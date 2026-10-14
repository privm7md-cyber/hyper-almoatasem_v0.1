// Root error boundary (App Router requires a Client Component here).
// Renders the shared ErrorState; never surfaces internals (digest is opaque).

"use client";

import { ErrorState } from "@/components/ui/states";

export default function RootError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center p-6">
      <ErrorState
        title="حدث خطأ غير متوقع"
        text="حاول إعادة المحاولة. إذا استمرت المشكلة، عُد لاحقًا."
        onRetry={reset}
      />
    </main>
  );
}
