// Dump check constraints on orders + any table with 'phone' columns on the disposable DB (read-only).
import { Client } from "pg";
const dba = new Client({ connectionString: process.env.V1_OPS_DATABASE_URL ?? process.env.DATABASE_URL });
await dba.connect();
const rows = await dba.query(`SELECT conname, conrelid::regclass::text AS table, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='c' AND (conrelid::regclass::text LIKE '%orders%' OR conrelid::regclass::text LIKE '%customers%' OR conrelid::regclass::text LIKE '%carts%') ORDER BY conname`);
console.log(JSON.stringify(rows.rows, null, 2));
await dba.end();
