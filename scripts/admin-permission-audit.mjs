// One-off audit: compare the permission keys that the code declares, the
// seed provisions, and the code actually enforces. Read-only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

// 1) The admin display catalogue.
const terminology = readFileSync(join(ROOT, "src/lib/admin/terminology.ts"), "utf8");
const groupsStart = terminology.indexOf("export const PERMISSION_GROUPS");
const groupsEnd = terminology.indexOf("\n];", groupsStart);
const catalogue = [
  ...new Set(
    [...terminology.slice(groupsStart, groupsEnd).matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]),
  ),
].sort();

// 2) The seed provisions.
const seed = readFileSync(join(ROOT, "prisma/seed.mjs"), "utf8");
const seedStart = seed.indexOf("const PERMISSIONS");
const seedEnd = seed.indexOf("\n];", seedStart);
const seeded = [
  ...new Set([...seed.slice(seedStart, seedEnd).matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1])),
].sort();

// 3) What the code actually enforces (permission strings passed to the guards).
const enforced = new Set();
const files = walk(join(ROOT, "src"));
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const patterns = [
    /requirePermission\(\s*"([^"]+)"/g,
    /checkPermission\(\s*"([^"]+)"/g,
    /adminOrDeny\(\s*"([^"]+)"/g,
    /adminOrDenyAll\(\s*\[([^\]]*)\]/g,
    /denyUnless\(\s*"([^"]+)"/g,
    /denyUnlessAll\(\s*\[([^\]]*)\]/g,
    /required="([^"]+)"/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      for (const key of m[1].matchAll(/"([^"]+)"/g)) enforced.add(key[1]);
      if (!m[1].includes('"')) enforced.add(m[1]);
    }
  }
}
const enforcedList = [...enforced].sort();

const diff = (a, b) => a.filter((x) => !b.includes(x));

console.log("catalogue (admin UI):", catalogue.length);
console.log("seed (DB provisioning):", seeded.length);
console.log("enforced in code:", enforcedList.length);
console.log("\nin code but NOT in catalogue:", diff(enforcedList, catalogue));
console.log("in catalogue but NOT in code:", diff(catalogue, enforcedList));
console.log("in catalogue but NOT seeded:", diff(catalogue, seeded));
console.log("in seed but NOT in catalogue:", diff(seeded, catalogue));
console.log("seeded but NOT enforced:", diff(seeded, enforcedList));
