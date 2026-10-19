// VXP Reveal unit tests: SSR-safe degradation + observer-driven reveal class swap.
// Contract: server HTML carries data-reveal="" (visible); the hidden "pending" state
// is only added by the client effect — with no IO support the attribute is removed.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reveal } from "../reveal";

describe("Reveal motion wrapper", () => {
  it("renders children visible against no IntersectionObserver (jsdom fallback)", () => {
    render(
      <Reveal>
        <p>القسم الأول</p>
      </Reveal>,
    );
    const p = screen.getByText("القسم الأول");
    expect(p).toBeVisible();
    // Fallback removes the hidden pending state entirely (attribute gone, wrapper stays).
    expect(p.closest('[data-reveal]')).toBeNull();
    expect(document.querySelector('[data-reveal="pending"]')).toBeNull();
  });

  it("starts pending and reveals via IntersectionObserver intersection", () => {
    let cb: IntersectionObserverCallback = () => {};
    class FakeIO {
      constructor(callback: IntersectionObserverCallback) {
        cb = callback;
      }
      observe = vi.fn((target: Element) => {
        targets.push(target);
      });
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    const targets: Element[] = [];
    vi.stubGlobal("IntersectionObserver", FakeIO);

    render(
      <Reveal delayMs={80}>
        <ul>
          <li>عناصر</li>
        </ul>
      </Reveal>,
    );
    const box = screen.getByText("عناصر").closest("[data-reveal]") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.dataset.reveal).toBe("pending");
    expect(targets).toHaveLength(1);
    cb([{ isIntersecting: true, target: box } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(box.dataset.reveal).toBe("in");

    // Stagger delay is passed as a CSS custom property, not inline opacity.
    expect(box.style.getPropertyValue("--reveal-delay")).toBe("80ms");
    vi.unstubAllGlobals();
  });

  it("never fires IO callback-content for non-intersecting entries", () => {
    let cb: IntersectionObserverCallback = () => {};
    class FakeIO {
      constructor(callback: IntersectionObserverCallback) {
        cb = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    render(
      <Reveal>
        <span id="rm-target">مخفي مؤقتًا</span>,
      </Reveal>,
    );
    const span = screen.getByText("مخفي مؤقتًا");
    const box = span.closest("[data-reveal]") as HTMLElement;
    cb([{ isIntersecting: false, target: box } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(box.dataset.reveal).toBe("pending");
    vi.unstubAllGlobals();
  });
});
