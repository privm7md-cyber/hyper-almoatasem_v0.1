// second-agent-name-probe.mjs — checks for exact ألبان product + المراعي brand on e2e DB.
import "dotenv/config";
import { Client } from "pg";

const u = new URL(process.env.MIGRATION_DATABASE_URL);
u.pathname = "/hyper_almoatasem_e2e_20261106";
const c = new Client({ connectionString: u.toString() });
await c.connect();
const r = await c.query(`SELECT count(*)::int n, min(name) ex FROM products WHERE name = 'ألبان' AND slug LIKE 'bab-scale%'`);
console.log("exact ألبان products:", r.rows[0].n, r.rows[0].ex);
const r2 = await c.query(`SELECT count(*)::int n FROM products WHERE hyper_norm_ar(name) LIKE '%' || hyper_norm_ar('لبن') || '%'`);
console.log("norm contains لبن:", r2.rows[0].n);
const r3 = await c.query(`SELECT name FROM products WHERE slug LIKE 'bab-scale%' LIMIT 5`);
console.log("sample:", JSON.stringify(r3.rows.map(x => x.name)));
await c.end();
