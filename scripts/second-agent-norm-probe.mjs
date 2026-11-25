// second-agent-norm-probe.mjs — tests hyper_norm_ar + collation on e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
try {
  const r = await c.query(`SELECT hyper_norm_ar('ألبان') AS n`);
  console.log("norm ok:", JSON.stringify(r.rows[0]));
} catch (e) { console.log("norm ERR:", e.message.slice(0, 160)); }
try {
  const r2 = await c.query(`SELECT collname FROM pg_collation WHERE collname = 'ar_eg'`);
  console.log("ar_eg rows:", r2.rowCount);
} catch (e) { console.log("coll ERR:", e.message.slice(0, 120)); }
const trgm = await c.query(`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`);
console.log("pg_trgm:", trgm.rowCount);
await c.end();
