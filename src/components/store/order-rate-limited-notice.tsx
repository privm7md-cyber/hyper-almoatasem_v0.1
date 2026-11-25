// Order read state: RATE_LIMITED.
//
// A rate-limited read is a TEMPORARY condition, not a missing order. Rendering
// it as a 404 told the customer their order does not exist — a false statement
// about their own data. The copy stays generic on purpose: no bucket, no
// window, no counter, no limiter name (that would leak the security posture
// and help a caller tune an evasion loop).
//
// Server component: it is rendered by the order pages, never by the client.

import Link from "next/link";
import { StoreShell } from "@/components/store/store-shell";

export function OrderRateLimitedNotice() {
  return (
    <StoreShell>
      <div className="mt-6">
        <p className="font-bold">عدد الطلبات كبير في الوقت الحالي</p>
        <p className="mt-2 text-sm text-secondary">
          طلبات كثيرة من هذا المتصفح خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/order-help" className="font-semibold text-brand">
            مساعدة الطلب
          </Link>
        </p>
      </div>
    </StoreShell>
  );
}
