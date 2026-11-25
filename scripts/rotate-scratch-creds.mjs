// Rotate the scratch-perf account password on the disposable... no — on the P12-06 scratch account (Primary host, scratch db).
// Writes the new creds to the P12-06 creds file. Read-write ONLY the scratch DB (account exists there).
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import argon2 from "argon2";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const url = new URL(process.env.DATABASE_URL);
url.pathname = "/hyper_almoatasem_scratch";
const db = new Client({ connectionString: url.toString() });
await db.connect();
const EMAIL = "p1206-perf@p1206-scratch.local";
const acc = await db.query("SELECT id, is_active, deleted_at, failed_login_attempts FROM users WHERE email = $1", [EMAIL]);
if (acc.rows.length !== 1) { console.log("ACCOUNT MISSING — abort"); await db.end(); process.exit(1); }
const row = acc.rows[0];
if (!row.is_active || row.deleted_at) { console.log("ACCOUNT NOT ACTIVE — abort"); await db.end(); process.exit(1); }
console.log("ACCOUNT FOUND:", EMAIL, "active:", row.is_active);
const { randomBytes } = await import("node:crypto");
const password = randomBytes(24).toString("base64url");
const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, row.id]);
writeFileSync("D:/Hyper_Data_Review/PHASE_12_PREMIUM_ENGINEERING/P12_06/Run_20261117_0900/backups/scratch-perf-creds.txt", `email: ${EMAIL}\npassword: ${password}\n`, { mode: 0o600 });
console.log("CREDS FILE REGENERATED (rotated)");
await db.end();
