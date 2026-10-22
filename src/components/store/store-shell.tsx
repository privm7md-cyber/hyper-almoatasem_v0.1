// Phase-11 store shell (server): header + bottom nav + footer around page content.
//
// The footer is a SIBLING of <main>, so the mobile bottom bar (fixed) used to
// cover the footer's last line. The footer now reserves the same space.

import { StoreHeader } from "./store-header";
import { StoreNav } from "./store-nav";
import { StoreFooter } from "./store-footer";
import { PageContainer } from "@/components/ui/container";

export function StoreShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StoreHeader />
      <StoreNav />
      <main id="main" className="pb-24 md:pb-8">
        <PageContainer>{children}</PageContainer>
      </main>
      <div className="pb-24 md:pb-0">
        <StoreFooter />
      </div>
    </>
  );
}
