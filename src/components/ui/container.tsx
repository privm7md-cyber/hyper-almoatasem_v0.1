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
    lg: "max-w-[1280px]",
    full: "max-w-none",
  } as const;
  return (
    <div className={["mx-auto w-full px-4 sm:px-5 md:px-6", widths[width], className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function PageTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h1 className={["text-2xl font-bold leading-[1.3] tracking-tight text-ink", className].filter(Boolean).join(" ")}>{children}</h1>;
}

export function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={["text-xl font-bold leading-[1.35] tracking-tight text-ink", className].filter(Boolean).join(" ")}>{children}</h2>;
}
