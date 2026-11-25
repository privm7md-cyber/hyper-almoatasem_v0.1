// Generates the owner-supplied catalogue manifest; no database connection.
import { writeFileSync } from "node:fs";
import { buildOwnerBrandManifest } from "../../src/lib/catalog/brand-management.ts";

const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
const entries = buildOwnerBrandManifest();
const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    rawNamesPreserved: true,
    duplicateNormalization: "NFC + trim + whitespace collapse + case-fold only",
    spellingCorrections: "NONE",
    ambiguousLabelsInstalled: false,
  },
  summary: {
    supplied: entries.length,
    installable: entries.filter((row) => row.disposition === "INSTALL").length,
    reviewRequired: entries.filter((row) => row.disposition === "REVIEW_REQUIRED").length,
    duplicates: entries.filter((row) => row.disposition === "DUPLICATE").length,
  },
  entries,
};
const text = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) writeFileSync(outPath, text, "utf8");
process.stdout.write(text);
