// Shared route↔OpenAPI bidirectional coverage check (static, no DB, no server).
// Single source of truth used by BOTH:
//   - scripts/api/t-ba-a-contract.mjs (S1 assertions, inside the live suite), and
//   - CI drift prevention: `node scripts/api/route-coverage.mjs` exits
//     non-zero on any drift (undocumented route OR stale doc entry).
// Comparison is path-identity only (same regexes both sides); method-level,
// envelope-level and permission-level governance live in the live suites.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function checkRouteCoverage() {
  const yaml = fs.readFileSync(path.join(ROOT, "docs/openapi.yaml"), "utf8");
  const docPaths = new Set([...yaml.matchAll(/^  (\/api\/[^:\s]+):/gm)].map((m) => m[1]));
  const routeFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") routeFiles.push(p);
    }
  };
  walk(path.join(ROOT, "src/app/api"));
  const implPaths = new Set(
    routeFiles.map((f) => {
      let rel = path.relative(path.join(ROOT, "src/app/api"), path.dirname(f)).replace(/\\/g, "/");
      rel = "/api/" + rel;
      rel = rel
        .replace(/\[id\]/g, "{id}")
        .replace(/\[variantId\]/g, "{variantId}")
        .replace(/\[addressId\]/g, "{addressId}")
        .replace(/\[itemId\]/g, "{itemId}")
        .replace(/\[roleId\]/g, "{roleId}")
        .replace(/\[permissionId\]/g, "{permissionId}")
        .replace(/\[targetId\]/g, "{targetId}")
        .replace(/\[replacementId\]/g, "{replacementId}")
        .replace(/\[key\]/g, "{key}");
      return rel;
    }),
  );
  return {
    docPaths,
    implPaths,
    missingInDoc: [...implPaths].filter((p) => !docPaths.has(p)),
    missingInImpl: [...docPaths].filter((p) => !implPaths.has(p)),
  };
}

// Direct execution: CI drift gate (exit 1 on any mismatch, names printed).
const isDirectRun = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const { docPaths, missingInDoc, missingInImpl } = checkRouteCoverage();
  console.log(
    JSON.stringify(
      {
        check: "route-coverage",
        docPaths: docPaths.size,
        missingInDoc,
        missingInImpl,
        pass: missingInDoc.length === 0 && missingInImpl.length === 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = missingInDoc.length === 0 && missingInImpl.length === 0 ? 0 : 2;
}
