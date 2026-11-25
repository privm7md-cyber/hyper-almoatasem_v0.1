// A "use server" module may export async functions ONLY.
//
// Next.js enforces this at REQUEST time, not at build time: the first call
// to a server action in a module that also exports a VALUE (a constant, a
// class, an enum, a re-exported object) throws
//
//   "A 'use server' file can only export async functions, found number."
//
// and EVERY action in that module dies with it. The build stays green and
// the unit tests stay green (they mock the action module), so the only
// honest detector is a runtime probe — which is how the storefront checkout
// and the order cancel/replace actions were found broken.
//
// This guard parses every module-level "use server" file in the repository
// and fails on any value export that is not an async function.
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

interface ExportFact {
  name: string;
  kind: string;
}

function sourceFile(path: string): ts.SourceFile {
  const text = readFileSync(path, "utf8");
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isUseServerModule(sf: ts.SourceFile): boolean {
  return sf.statements.some(
    (s) =>
      ts.isExpressionStatement(s) &&
      ts.isStringLiteral(s.expression) &&
      s.expression.text === "use server",
  );
}

function collectUseServerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      collectUseServerFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    if (isUseServerModule(sourceFile(full))) out.push(full);
  }
  return out;
}

function exportedValues(sf: ts.SourceFile): ExportFact[] {
  const facts: ExportFact[] = [];
  const modifiers = (node: ts.Node): readonly ts.Modifier[] =>
    ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  for (const statement of sf.statements) {
    const mods = modifiers(statement);
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported) {
      if (ts.isFunctionDeclaration(statement)) {
        facts.push({
          name: statement.name?.text ?? "default",
          kind: mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
            ? "async-function"
            : "function",
        });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          facts.push({ name: declaration.name.getText(sf), kind: "variable" });
        }
      } else if (ts.isClassDeclaration(statement)) {
        facts.push({ name: statement.name?.text ?? "default", kind: "class" });
      } else if (ts.isEnumDeclaration(statement)) {
        facts.push({ name: statement.name.text, kind: "enum" });
      }
      // Interfaces and type aliases are erased at compile time: they never
      // reach the "use server" export check.
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          facts.push({ name: element.name.text, kind: "re-export" });
        }
      }
    }
    if (ts.isExportAssignment(statement)) {
      facts.push({ name: "default", kind: "export-assignment" });
    }
  }
  return facts;
}

describe('"use server" modules export async functions only', () => {
  const files = collectUseServerFiles(SRC_ROOT);

  it("finds the server-action modules of the repository", () => {
    const relative = files.map((f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, "/"));
    expect(relative).toContain("src/app/actions/orders.ts");
    expect(relative).toContain("src/app/actions/auth.ts");
    expect(relative).toContain("src/app/actions/catalog.ts");
  });

  it("never exports a value that is not an async function", () => {
    const violations: string[] = [];
    for (const file of files) {
      const sf = sourceFile(file);
      const asyncNames = new Set(
        exportedValues(sf)
          .filter((f) => f.kind === "async-function")
          .map((f) => f.name),
      );
      for (const fact of exportedValues(sf)) {
        const allowed = fact.kind === "async-function" || (fact.kind === "re-export" && asyncNames.has(fact.name));
        if (!allowed) {
          violations.push(
            `${file.slice(REPO_ROOT.length + 1).replace(/\\/g, "/")}: export '${fact.name}' is a ${fact.kind}`,
          );
        }
      }
    }
    expect(violations, "a value export in a 'use server' file breaks every action in it").toEqual([]);
  });
});
