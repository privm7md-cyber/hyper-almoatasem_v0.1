// Root error boundary (App Router requires a Client Component here).
// Renders the shared ErrorState; never surfaces internals (digest is opaque).
// FE-9: adds a way back to the store; a server error is reported as an error
// and is never disguised as a "page not found".

"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui/states";

export default function RootError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center p-6">
      <ErrorState
        title="حدث خطأ غير متوقع"
        text="حاول إعادة المحاولة. إذا استمرت المشكلة، عُد لاحقًا."
        onRetry={reset}
      />
      <p className="mt-3 text-center text-sm">
        <Link href="/" className="font-semibold text-brand">
          العودة إلى المتجر
        </Link>
      </p>
    </main>
  );
}
