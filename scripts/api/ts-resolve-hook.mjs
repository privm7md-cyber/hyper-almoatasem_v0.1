// Test-only ESM resolve hook (BA-1 test infrastructure, never production code).
// Plain Node type-stripping requires explicit `.ts` extensions, but Next.js /
// TypeScript `bundler` resolution forbids them — source files therefore use
// extensionless relative imports (the toolchain-correct form, verified by
// `tsc` + `next build`). This hook maps extensionless relative specifiers to
// `.ts` files so the same sources run unmodified under plain `node` tests.
// Usage: node --import ./scripts/api/ts-resolve-hook.mjs <test-file>
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, next) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-zA-Z0-9]+$/.test(specifier)
  ) {
    const parentPath = context.parentURL.startsWith("file:")
      ? fileURLToPath(context.parentURL)
      : context.parentURL;
    const candidate = resolvePath(dirname(parentPath), specifier + ".ts");
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
