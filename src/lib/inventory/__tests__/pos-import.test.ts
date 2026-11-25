// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapPosColumns, posImportInputSchema } from "../pos-import";
import type { ImportFileTable } from "../import-file";

describe("POS column mapping", () => {
  it("maps Arabic POS headers to fields", () => {
    const table: ImportFileTable = {
      sheets: ["POS"], sheet: "POS",
      headers: ["1: الكود", "2: الاسم", "3: الكمية", "4: وحدة", "5: السعر"],
      rows: [
        { row: 2, cells: ["POS-1", "منتج أول", "5", "PIECE", "12.50"] },
      ],
    };
    const [c] = mapPosColumns(table);
    expect(c).toMatchObject({ row: 2, code: "POS-1", name: "منتج أول", quantity: "5", unit: "PIECE", sourcePrice: "12.50" });
  });
  it("maps English headers and tolerates missing columns", () => {
    const table: ImportFileTable = {
      sheets: ["S"], sheet: "S",
      headers: ["1: code", "2: name", "3: quantity", "4: unit"],
      rows: [{ row: 2, cells: ["A", "Widget", "7", "PIECE"] }],
    };
    const [c] = mapPosColumns(table);
    expect(c).toMatchObject({ row: 2, code: "A", name: "Widget", quantity: "7", unit: "PIECE", sourcePrice: "" });
  });
  it("ignores unmapped/blank headers and never invents a value", () => {
    const table: ImportFileTable = {
      sheets: ["S"], sheet: "S",
      headers: ["1: (blank)"],
      rows: [{ row: 2, cells: ["junk"] }],
    };
    const [c] = mapPosColumns(table);
    expect(c.code).toBe(""); expect(c.name).toBe(""); expect(c.quantity).toBe("");
  });
});
describe("POS apply input schema", () => {
  it("requires source, asOf, reason", () => {
    expect(posImportInputSchema.safeParse({ source: "a-test-source", asOf: "2026-01-01T00:00:00Z", reason: "test-reason" }).success).toBe(true);
    expect(posImportInputSchema.safeParse({ source: "a-test-source", asOf: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });
});
