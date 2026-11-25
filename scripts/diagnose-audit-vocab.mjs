// Diagnostic: source `action:` set vs AUDIT_ACTIONS set from audit-vocabulary.ts (read-only).
import fs from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

const found = new Set();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(p);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      const text = fs.readFileSync(p, "utf8");
      for (const match of text.matchAll(/action:\s*"([a-z0-9_.]+)"/g)) found.add(match[1]);
    }
  }
}
walk("src");
const vocabText = fs.readFileSync("src/lib/admin/audit-vocabulary.ts", "utf8");
const vocabSet = new Set([...vocabText.matchAll(/action:\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]));
console.log("source actions:", [...found].length);
console.log("vocabulary actions:", vocabSet.size);
console.log("missing from vocabulary:", [...found].filter((a) => !vocabSet.has(a)));
console.log("extra in vocabulary:", [...vocabSet].filter((a) => !found.has(a)));
