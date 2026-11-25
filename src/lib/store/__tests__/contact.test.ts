// Phase-13 owner-approval reconciliation — the published contact channel and
// the two approved policy rules must not drift.
//
// These tests pin the POLICY that governs the published pages, not the copy:
//   * the approved number lives in ONE module and every published surface reads
//     it from there (no duplicated literal that can go stale);
//   * every surface that SHOWS the number renders it through the shared
//     contact link, so the displayed number and its `tel:` target are one;
//   * NO WhatsApp claim in the published copy (the owner never confirmed that
//     the number runs a WhatsApp account);
//   * the stale "support channel not configured" text is gone;
//   * the approved number is reachable from the footer, the mobile menu and
//     the sitemap;
//   * the approved cancellation/replacement rules are published on the pages
//     that own them, and neither page promises a fee, a schedule, a refund,
//     a replacement date or substitute availability.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_CONTACT_PHONE, STORE_CONTACT_TEL, STORE_CONTACT_TEL_HREF } from "@/lib/store/contact";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** The file's CODE — comments stripped, so a source note never fails a copy rule. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PUBLISHED_SURFACES = [
  "src/app/contact/page.tsx",
  "src/app/cancellation/page.tsx",
  "src/app/replacement/page.tsx",
  "src/app/order-help/page.tsx",
  "src/app/faq/page.tsx",
  "src/components/store/store-footer.tsx",
  "src/components/store/contact-link.tsx",
  "src/components/store/checkout-flow.tsx",
];

describe("the approved contact channel", () => {
  it("exposes exactly one well-formed number", () => {
    expect(STORE_CONTACT_PHONE).toMatch(/^01[0-9]{9}$/);
    expect(STORE_CONTACT_TEL).toMatch(/^\+201[0-9]{9}$/);
    expect(STORE_CONTACT_TEL).toBe(`+20${STORE_CONTACT_PHONE.slice(1)}`);
    expect(STORE_CONTACT_TEL_HREF).toBe(`tel:${STORE_CONTACT_TEL}`);
  });

  it("keeps the number in ONE module — no surface hard-codes it", () => {
    const contactModule = source("src/lib/store/contact.ts");
    expect(contactModule).toContain(`"${STORE_CONTACT_PHONE}"`);
    for (const file of PUBLISHED_SURFACES) {
      expect(code(file)).not.toContain(STORE_CONTACT_PHONE);
    }
  });

  it("renders the number through the shared contact link on every surface that shows it", () => {
    for (const file of [
      "src/app/contact/page.tsx",
      "src/app/cancellation/page.tsx",
      "src/app/replacement/page.tsx",
      "src/app/order-help/page.tsx",
      "src/app/faq/page.tsx",
      "src/components/store/store-footer.tsx",
    ]) {
      expect(code(file)).toContain("StoreContactLink");
    }
    // The shared link is the only place a `tel:` target is built.
    const link = code("src/components/store/contact-link.tsx");
    expect(link).toContain("tel:");
    expect(link).toContain("STORE_CONTACT_TEL");
  });

  it("claims no WhatsApp channel", () => {
    for (const file of PUBLISHED_SURFACES) {
      expect(code(file)).not.toMatch(/wa\.me|api\.whatsapp|whatsapp/i);
    }
  });

  it("carries no stale 'support is not configured' text", () => {
    for (const file of PUBLISHED_SURFACES) {
      expect(code(file)).not.toContain("قناة الدعم غير مهيأة");
    }
  });

  it("reaches the contact page from the footer, the menu and the sitemap", () => {
    expect(code("src/components/store/store-footer.tsx")).toContain('href: "/contact"');
    expect(code("src/components/store/store-menu.tsx")).toContain('href: "/contact"');
    expect(code("src/app/sitemap.ts")).toContain('{ path: "/contact"');
  });
});

describe("the approved cancellation rule", () => {
  const page = code("src/app/cancellation/page.tsx");

  it("states the self-service window that the server enforces", () => {
    expect(page).toContain("تم استلام طلبك.");
    expect(page).toContain("تم تأكيد الطلب.");
    expect(page).toContain("جاري تجهيز طلبك.");
  });

  it("routes the post-preparation case to the store review", () => {
    expect(page).toContain("طلبك جاهز");
    expect(page).toContain("مراجعة");
    expect(page).toContain("StoreContactLink");
  });

  it("promises no fee, no schedule and no refund", () => {
    expect(page).toContain("لا تُخصم أي");
    expect(page).not.toMatch(/خلال\s*\d+\s*(ساعة|يوم|يوما)/);
    expect(page).not.toContain("استرداد المبلغ");
  });
});

describe("the approved product-problem rule", () => {
  const page = code("src/app/replacement/page.tsx");

  it("names the three approved cases and the store's review", () => {
    expect(page).toContain("منتجًا مختلفًا");
    expect(page).toContain("تالفًا");
    expect(page).toContain("اختلافًا بين المنتج");
    expect(page).toContain("StoreContactLink");
  });

  it("promises neither substitute availability nor a replacement date nor a refund", () => {
    expect(page).toContain("لا يَعِد بوجود بديل متاح");
    expect(page).not.toMatch(/خلال\s*\d+\s*(ساعة|يوم|يوما)/);
    expect(page).not.toContain("يُسترد المبلغ");
  });

  it("does not invent a self-service request feature", () => {
    expect(page).toContain("لا يوجد في الموقع زر لطلب");
  });
});
