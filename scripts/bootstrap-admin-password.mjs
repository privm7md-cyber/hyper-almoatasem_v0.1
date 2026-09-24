// ============================================================================
// Owner bootstrap CLI: sets the FIRST (or rotates an existing) admin password.
// Safety design:
//  - Target database is parsed from the connection URL BEFORE connecting:
//    production (`hyper_almoatasem`), `postgres`, and unknown databases are
//    refused with zero database contact. Only explicitly allowlisted scratch
//    databases proceed. After connecting, current_database() is asserted again.
//  - Password is NEVER a CLI argument. It is read hidden from a TTY; in
//    non-TTY mode (automated tests) it is read as two piped lines
//    (password + confirmation). It is never logged, never stored plaintext.
//  - Updates the EXISTING bootstrap identity (default owner email, or --email);
//    refuses when the user row is missing (no new users are created here).
//  - Argon2id (OWASP minimums) + policy 12..128 + audit event, one transaction.
// Usage:
//   DATABASE_URL=<scratch-url> node scripts/bootstrap-admin-password.mjs [--email <addr>]
// ============================================================================

import { Client } from "pg";
import * as readline from "node:readline";
import argon2 from "argon2";
import "dotenv/config";

const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function dbNameFromUrl(connectionString) {
  try {
    return new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

async function readHidden(question) {
  if (!process.stdin.isTTY) {
    // Automated mode (tests): two piped lines, password then confirmation.
    const lines = [];
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
      lines.push(line.replace(/\r$/, ""));
      if (lines.length >= 2) break;
    }
    return lines;
  }
  process.stdout.write(question);
  return await new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = (result) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(result);
    };
    const onData = (key) => {
      if (key === "\u0003") {
        process.stdout.write("\n");
        process.exit(130);
      }
      if (key === "\r" || key === "\n") {
        done(value);
        return;
      }
      if (key === "\u007f" || key === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += key;
    };
    stdin.on("data", onData);
  }).then(async (first) => {
    process.stdout.write("Confirm password: ");
    const second = await new Promise((resolve2) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      let value = "";
      const onData2 = (key) => {
        if (key === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (key === "\r" || key === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData2);
          process.stdout.write("\n");
          resolve2(value);
          return;
        }
        if (key === "\u007f" || key === "\b") {
          value = value.slice(0, -1);
          return;
        }
        value += key;
      };
      stdin.on("data", onData2);
    });
    return [first, second];
  });
}

async function main() {
  const emailFlag = process.argv.indexOf("--email");
  const email = (emailFlag === -1 ? "owner@hyper-al-moatasem.local" : process.argv[emailFlag + 1] || "").toLowerCase();
  if (!email || !email.includes("@")) fail("BOOTSTRAP_DENIED: valid --email required");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail("BOOTSTRAP_DENIED: DATABASE_URL is missing");

  // Pre-connection guard: parse the target name from the URL itself.
  const urlDb = dbNameFromUrl(connectionString);
  if (urlDb === "hyper_almoatasem") fail("BOOTSTRAP_DENIED: refusing production database (pre-connection)");
  if (!ALLOWED_SCRATCH_DBS.includes(urlDb)) fail(`BOOTSTRAP_DENIED: unknown database (pre-connection)`);

  const [password, confirm] = await readHidden("New owner password: ");
  if (!password || password !== confirm) fail("BOOTSTRAP_FAILED: password confirmation mismatch");
  if (password.length < PASSWORD_MIN) fail(`BOOTSTRAP_FAILED: password too short (min ${PASSWORD_MIN})`);
  if (password.length > PASSWORD_MAX) fail(`BOOTSTRAP_FAILED: password too long (max ${PASSWORD_MAX})`);

  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    // Post-connection guard: live metadata assertion (defense in depth).
    const meta = (await client.query(`SELECT current_database() AS db, current_user AS usr`)).rows[0];
    if (meta.db === "hyper_almoatasem" || !ALLOWED_SCRATCH_DBS.includes(meta.db)) {
      fail(`BOOTSTRAP_DENIED: refusing database ${meta.db} (live assertion)`);
    }
    const user = (await client.query(`SELECT id, email FROM users WHERE email = $1`, [email])).rows[0];
    if (!user) fail(`BOOTSTRAP_FAILED: no existing identity for ${email} (refusing to create users here)`);
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2`,
        [passwordHash, user.id],
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, actor_type, action, entity_type, entity_id)
         VALUES ($1, 'ADMIN', 'auth.bootstrap_password_set', 'users', $1)`,
        [user.id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
    console.log(JSON.stringify({ ok: true, database: meta.db, user: meta.usr, email, passwordUpdated: true }));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`BOOTSTRAP_FAILED: ${e.message}`);
  process.exit(1);
});
