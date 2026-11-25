// second-agent-rl-inspect.mjs — inspects rate-limit tables on isolated e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const tables = (await c.query(`select tablename from pg_tables where schemaname='public' and tablename ilike '%rate%'`)).rows;
for (const t of tables) {
  console.log("TABLE", t.tablename);
  try {
    const rows = (await c.query(`select * from public."${t.tablename}"`)).rows;
    for (const r of rows.slice(0, 8)) console.log("  ", JSON.stringify(r).slice(0, 220));
    console.log("  total rows:", rows.length);
  } catch (e) { console.log("  ERR", e.message.slice(0, 120)); }
}
await c.end();
