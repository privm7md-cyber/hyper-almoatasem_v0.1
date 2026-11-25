// Storefront root loading boundary (GAP-04 remediation).
// Provides an accessible RTL loading state during route transitions without
// altering HTTP status codes or RBAC gates.

import { StoreShell } from "@/components/store/store-shell";
import { LoadingState } from "@/components/ui/states";

export default function StoreLoading() {
  return (
    <StoreShell isLoadingFallback>
      <div className="mt-6" data-route-loading="true">
        <LoadingState label="جارٍ التحميل…" />
      </div>
    </StoreShell>
  );
}
