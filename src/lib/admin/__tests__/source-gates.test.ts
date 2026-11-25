import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("D7/D8 source regressions (not browser proof)", () => {
  it("positions the RTL chevron on the logical inline end with an LTR override", () => {
    const css = readFileSync(resolve("src/app/admin/admin.css"), "utf8");
    const select = css.match(/\.adm-select \{([\s\S]*?)\n\}/)?.[1];
    expect(select).toContain("12px calc(50% + 1px)");
    expect(select).toContain("17px calc(50% + 1px)");
    expect(select).toContain("padding-inline-end: 34px");
    expect(css).toContain(".adm-select:dir(ltr)");
  });
  it("keeps next/font Cairo and removes stale hardcoded font preloads", () => {
    const layout = readFileSync(resolve("src/app/layout.tsx"), "utf8");
    expect(layout).toContain("const cairo = Cairo(");
    expect(layout).toContain('subsets: ["arabic", "latin"]');
    expect(layout).not.toMatch(/href=["']\/_next\/static\/media\/.*\.woff2/);
    expect(layout).not.toContain("350b852752f8489d");
    expect(layout).not.toContain("01f0c602c274ea55");
  });
});
