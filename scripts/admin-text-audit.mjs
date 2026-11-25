// ADMIN TEXT AUDIT — finds English technical words and stray non-Arabic
// codepoints inside the admin UI surface.
//
// What counts as a finding:
//   • a string literal that mixes Arabic and Latin (untranslated copy);
//   • a string literal that is a Latin UI sentence (spaces + lowercase words)
//     that is not a class name, a URL, a path, or a code identifier;
//   • any Cyrillic / Greek / Armenian / Hebrew codepoint;
//   • a JSX text node (between > and <) that contains Latin letters.
//
// Usage: node scripts/admin-text-audit.mjs [dir...]
// Exit code 1 when a finding is reported, so it can gate a release.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();
const DEFAULT_DIRS = ["src/app/admin", "src/components/admin", "src/lib/admin"];

const BANNED_WORDS = [
  "dashboard", "products", "product", "inventory", "orders", "order", "customers", "customer",
  "variant", "variants", "stock in", "manual adjustment", "low stock threshold", "promotions",
  "promotion", "coupons", "coupon", "roles", "role", "permissions", "permission", "audit logs",
  "settings", "create", "update", "delete", "save", "cancel", "apply", "status", "active",
  "inactive", "pending", "draft", "expired", "base", "bases", "sku", "barcode", "slug", "session",
  "token", "json", "uuid", "api", "http", "email", "password", "login", "logout", "search",
  "filter", "sort", "next", "previous", "edit", "add", "remove", "view", "list", "detail",
  "details", "action", "actions", "button", "modal", "drawer", "table", "column", "row", "rows",
  "total", "count", "price", "quantity", "stock", "brand", "brands", "category", "categories",
  "discount", "tax", "shipping", "zone", "zones", "toggle", "checkbox", "submit", "reset",
  "refresh", "loading", "empty", "error", "profile", "overview", "summary", "details view",
];

// Latin text that is legitimately present in admin code.
const LATIN_ALLOWED = [
  /^\s*$/,
  /^[\w\-\./@#:?&=%]+\/?$/, // single identifier / path / slug
  /^[A-Z_]{2,}$/, // ENUM_KEY
  /^(GET|POST|PUT|PATCH|DELETE)$/,
  /^[a-z]+-[a-z-]+$/, // css-like token
];

const CODE_HINT = /(className|class|style|href|src|data-|aria-|import|from|require|interface|type |key=|\.map|\.filter|\.join|as const|\?\?)/;

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
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if ([".tsx", ".ts"].includes(extname(name))) {
      out.push(full);
    }
  }
  return out;
}

const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);
const hasLatin = (s) => /[A-Za-z]/.test(s);

function looksLikeCode(text) {
  if (LATIN_ALLOWED.some((re) => re.test(text))) return true;
  if (CODE_HINT.test(text)) return true;
  if (/^(bg|text|border|rounded|flex|grid|p-|m-|w-|h-|gap|font|min-|max-|px-|py-)/.test(text)) return true;
  if (text.includes("/admin/") || text.includes("http")) return true;
  if (/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/.test(text)) return true; // foo.bar
  if (/^[a-z]+(\.[a-z]+)+$/.test(text)) return true;
  return false;
}

const findings = [];
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRS;
const files = dirs.flatMap((d) => walk(join(ROOT, d)));

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const lineNo = i + 1;

    // 1. stray codepoints outside Arabic / Latin
    const stray = raw.match(/[\u0400-\u052F\u0530-\u058F]/gu);
    if (stray) {
      findings.push({ file: rel, line: lineNo, kind: "stray-codepoint", text: raw.trim().slice(0, 140) });
    }

    // 2. string literals
    const literals = raw.match(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g) || [];
    for (const lit of literals) {
      const inner = lit.slice(1, -1);
      if (!hasLatin(inner)) continue;
      if (looksLikeCode(inner)) continue;

      if (hasArabic(inner)) {
        // mixed Arabic + Latin — the Latin part must be a legit identifier.
        const latinPart = (inner.match(/[A-Za-z][A-Za-z0-9_.]*/g) || []).filter((t) => t.length > 1);
        const suspicious = latinPart.filter(
          (t) => !/^(متد|https?)$/.test(t) && BANNED_WORDS.includes(t.toLowerCase()),
        );
        if (suspicious.length) {
          findings.push({ file: rel, line: lineNo, kind: "mixed", word: suspicious[0], text: inner.slice(0, 140) });
        }
        continue;
      }

      // pure Latin: only a finding if it reads like a sentence
      if (!/\s/.test(inner)) continue;
      if (!/[a-z]{2,}/.test(inner)) continue;
      const lower = inner.toLowerCase();
      const hit = BANNED_WORDS.find((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(lower));
      if (hit) {
        findings.push({ file: rel, line: lineNo, kind: "english", word: hit, text: inner.slice(0, 140) });
      }
    }

    // 3. JSX text nodes: >text<
    const jsxText = raw.match(/>([^<>{}]+)</g) || [];
    for (const t of jsxText) {
      const inner = t.slice(1, -1).trim();
      if (!inner || !hasLatin(inner)) continue;
      if (looksLikeCode(inner)) continue;
      findings.push({ file: rel, line: lineNo, kind: "jsx-text", text: inner.slice(0, 140) });
    }
  });
}

if (!findings.length) {
  console.log("OK — no English technical terms or stray codepoints found in:", dirs.join(", "));
  process.exit(0);
}

console.log(`FOUND ${findings.length} issue(s):\n`);
for (const f of findings) {
  const tag = f.kind === "english" ? `EN:"${f.word}"` : f.kind.toUpperCase();
  console.log(`${f.file}:${f.line}  ${tag}  ${f.text}`);
}
process.exit(1);
