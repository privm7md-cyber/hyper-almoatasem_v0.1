// Cross-checks the server's English error strings against the Arabic
// translation table in src/lib/admin/errors.ts.
//
// Every message the server can return to an ADMIN request must have an Arabic
// translation, otherwise the admin shows the code fallback (generic Arabic) —
// still Arabic, but the operator loses the specific reason.
//
// Usage: node scripts/admin-error-coverage.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

// --- server messages -------------------------------------------------------
const MSG_RE = /"((?:[^"\\]|\\.)*[.!])"/g;
const messages = new Set();
for (const file of walk(join(ROOT, "src/lib")).concat(walk(join(ROOT, "src/app/api")))) {
  const src = readFileSync(file, "utf8");
  // only messages that look like human sentences, not identifiers
  for (const m of src.matchAll(MSG_RE)) {
    const text = m[1];
    if (!/^[A-Z]/.test(text)) continue;
    if (text.length < 12) continue;
    if (!/\s/.test(text)) continue;
    if (!/^[A-Za-z ,.'\-()]+$/.test(text)) continue;
    messages.add(text);
  }
}

// --- translation table -----------------------------------------------------
const tableSrc = readFileSync(join(ROOT, "src/lib/admin/errors.ts"), "utf8");
const translated = new Set();
for (const m of tableSrc.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*"/gm)) {
  translated.add(m[1]);
}

const missing = [...messages].filter((m) => !translated.has(m)).sort();

console.log(`server messages: ${messages.size}`);
console.log(`translated:      ${translated.size}`);
console.log(`missing:         ${missing.length}`);
if (missing.length) {
  console.log("\nMISSING (server message → no Arabic translation):");
  for (const m of missing) console.log("  • " + m);
  process.exit(1);
}
console.log("\nOK — every server message has an Arabic translation.");
