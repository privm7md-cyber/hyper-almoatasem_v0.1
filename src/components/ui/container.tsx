// FE-1 shared layout primitives (server components: semantic, no handlers).

import React from "react";

export function PageContainer({
  width = "md",
  children,
  className = "",
}: {
  width?: "sm" | "md" | "lg" | "full";
  children: React.ReactNode;
  className?: string;
}) {
  const widths = {
    sm: "max-w-[560px]",
    md: "max-w-[1200px]",
    lg: "max-w-[1200px]",
    full: "max-w-none",
  } as const;
  return <div className={`mx-auto w-full px-4 md:px-6 ${widths[width]} ${className}`}>{children}</div>;
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold leading-[1.3]">{children}</h1>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold leading-[1.35]">{children}</h2>;
}
