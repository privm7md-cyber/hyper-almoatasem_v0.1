// Debug B2: parse the stored-alternatives envelope of the B2 proposal row via the real module.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s, c, next) {
  if (s.startsWith("@/")) return next(pathToFileURL(path.resolve("src", s.slice(2) + ".ts")).href, c);
  return next(s, c);
}});
const { parseStoredAlternativesEnvelope, parseStoredAlternatives } = await import("../src/lib/replacements/validation.ts");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = (await db.query(`SELECT id, status, reason FROM order_item_replacements WHERE reason LIKE '%d8774a77%' LIMIT 3`)).rows;
for (const row of rows) {
  const env = parseStoredAlternativesEnvelope(row.reason);
  console.log(row.id, "env:", JSON.stringify(env, null, 1));
  console.log("alts:", JSON.stringify(parseStoredAlternatives(row.reason)));
}
await db.end();
