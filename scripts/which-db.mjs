// Prints ONLY the database NAME the local dev server points at. Never prints a
// host, a user, a password, or a connection string.
//
// Usage: node scripts/which-db.mjs

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = {
  ...parseEnvFile(join(ROOT, ".env")),
  ...parseEnvFile(join(ROOT, ".env.local")),
  ...process.env,
};

for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const value = env[key];
  if (!value) {
    console.log(`${key}: (not set)`);
    continue;
  }
  try {
    const url = new URL(value);
    const host = url.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    console.log(`${key}: database=${url.pathname.replace(/^\//, "")}  host=${host}  local=${isLocal}`);
  } catch {
    console.log(`${key}: (unparsable)`);
  }
}
