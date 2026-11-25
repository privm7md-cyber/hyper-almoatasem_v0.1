import "@testing-library/jest-dom/vitest";

delete process.env.CUSTOMER_AUDIT_REDACTION_MODE;

// jsdom does not implement window.matchMedia. Provide a deterministic stub in
// the REDUCED-MOTION state: motion islands (GSAP/R3F/motion) treat tests as
// reduced-motion and stay inert, so component assertions never depend on
// animation timing — the same contract the app guarantees real users who
// prefer reduced motion.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}
