import { describe, expect, it } from "vitest";
import { formatDate, formatDateLong, formatDateTime, hasArabicText, operatorDisplayName } from "../terminology";

describe("hasArabicText", () => {
  it("recognises Arabic text without treating Latin text as Arabic", () => {
    expect(hasArabicText("أحمد")).toBe(true);
    expect(hasArabicText("  مالك المتجر  ")).toBe(true);
    for (const value of ["System Owner", "", null, undefined]) expect(hasArabicText(value)).toBe(false);
  });
});

describe("operatorDisplayName", () => {
  it("preserves the actual account name in any language", () => {
    expect(operatorDisplayName("أحمد", ["STORE_ADMIN"])).toBe("أحمد");
    expect(operatorDisplayName("System Owner", ["SUPER_ADMIN"])).toBe("System Owner");
    expect(operatorDisplayName("  Jane Doe  ", ["STORE_ADMIN"])).toBe("Jane Doe");
    expect(operatorDisplayName("System Owner", [])).toBe("System Owner");
  });

  it("uses role or neutral fallback only for a missing name", () => {
    expect(operatorDisplayName("", ["SUPER_ADMIN"])).toBe("مالك المتجر");
    expect(operatorDisplayName(null, ["STORE_ADMIN"])).toBe("مدير المتجر");
    expect(operatorDisplayName(undefined, ["SOME_CUSTOM_ROLE"])).toBe("مستخدم المتجر");
    expect(operatorDisplayName("   ", [])).toBe("مستخدم المتجر");
  });
});

describe("central admin English dates", () => {
  it("uses en-GB short dates and English full dates", () => {
    expect(formatDate("2026-03-12")).toBe("12 Mar 2026");
    expect(formatDateLong("2026-03-12")).toBe("12 March 2026");
    expect(formatDateTime("2026-03-12T02:35:00Z")).toBe("12 Mar 2026, 04:35");
  });

  it("uses Africa/Cairo timestamps, including DST and day/year boundaries", () => {
    expect(formatDate("2026-03-11T23:30:00Z")).toBe("12 Mar 2026");
    expect(formatDateTime("2026-03-11T23:30:00Z")).toBe("12 Mar 2026, 01:30");
    expect(formatDateLong("2026-03-11T23:30:00Z")).toBe("12 March 2026");
    expect(formatDateTime("2026-07-01T21:30:00Z")).toBe("02 Jul 2026, 00:30");
    expect(formatDateTime("2026-12-31T23:30:00Z")).toBe("01 Jan 2027, 01:30");
  });

  it("accepts Date objects and offset timestamps consistently", () => {
    const instant = new Date("2026-03-12T02:35:00Z");
    expect(formatDateTime(instant)).toBe(formatDateTime("2026-03-12T04:35:00+02:00"));
    expect(formatDate(instant)).toBe("12 Mar 2026");
    expect(formatDateLong(instant)).toBe("12 March 2026");
  });

  it("never shifts exact calendar-only values or fabricates their time", () => {
    for (const [value, short] of [["2026-01-01", "01 Jan 2026"], ["2024-02-29", "29 Feb 2024"], ["2026-12-31", "31 Dec 2026"]]) {
      expect(formatDate(value)).toBe(short);
      expect(formatDateTime(value)).toBe(short);
    }
    expect(formatDateLong("2024-02-29")).toBe("29 February 2024");
  });

  it.each([null, undefined, "", "not-a-date", "2026-02-30", "2025-02-29", "2026-02-30T23:00:00Z", "2026-13-01", "2026-00-01", "2026-01-00", new Date(NaN)])("keeps invalid/missing input unknown: %s", (value) => {
    expect(formatDate(value)).toBe("غير معروف");
    expect(formatDateTime(value)).toBe("غير معروف");
    expect(formatDateLong(value)).toBe("غير معروف");
  });
});
