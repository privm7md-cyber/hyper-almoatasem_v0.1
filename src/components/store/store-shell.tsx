// FE-2/FE-3 shared store shell (server): header + bottom nav + footer around page content.

import { StoreHeader } from "./store-header";
import { StoreNav } from "./store-nav";
import { StoreFooter } from "./store-footer";
import { PageContainer } from "@/components/ui/container";

export function StoreShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StoreHeader />
      <StoreNav />
      <main className="pb-24 md:pb-8">
        <PageContainer>{children}</PageContainer>
      </main>
      <StoreFooter />
    </>
  );
}
