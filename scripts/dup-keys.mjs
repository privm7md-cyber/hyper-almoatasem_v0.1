// Reports duplicate keys in an object literal (TS1117) inside a source file.
// Usage: node scripts/dup-keys.mjs <file>
import { readFileSync } from "node:fs";

const file = process.argv[2];
const src = readFileSync(file, "utf8");
const seen = new Map();
const lines = src.split(/\r?\n/);
lines.forEach((line, i) => {
  const m = line.match(/^\s*"((?:[^"\\]|\\.)*)":/);
  if (!m) return;
  const key = m[1];
  if (seen.has(key)) {
    console.log(`DUPLICATE key at line ${i + 1}: "${key}"  (first at line ${seen.get(key)})`);
  } else {
    seen.set(key, i + 1);
  }
});
