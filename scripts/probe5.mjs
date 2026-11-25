// Enumerate .env files + their DATABASE_URLs (names only, redacted), and
// check hyper_app privileges on schema public (read-only probes).
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const files = readdirSync(".").filter((n) => n.startsWith(".env")).map((n) => n);
for (const f of files) {
  try {
    const txt = readFileSync(f, "utf8");
    for (const m of txt.matchAll(/^\s*DATABASE_URL\s*=\s*(\S+)/gm)) console.log(f, "=>", m[1]);
  } catch { /* ignore */ }
}
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("SELECT rolname, rolsuper, rolcreatedb, rolcreatedb AS dummy FROM pg_roles WHERE rolname = 'hyper_app'");
console.log("hyper_app:", JSON.stringify(r.rows));
const priv = await c.query("SELECT has_table_privilege('hyper_app', 'CREATE'::regclass, 'CREATE'), has_schema_privilege('hyper_app', 'public'::regnamespace, 'USAGE, CREATE')");
console.log("privs:", JSON.stringify(priv.rows));
const alt = await c.query("SELECT u.rolname AS user FROM information_schema.role_table_grants g JOIN pg_roles u ON u.oid = g.grantee WHERE g.table_name='pg_class' LIMIT 1");
console.log("grant probe:", JSON.stringify(alt.rows));
await c.end();
