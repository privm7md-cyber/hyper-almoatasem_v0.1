import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { fingerprint, inspect, quote, sha256 } from "./sqlite-snapshot.mjs";
import { postgresSchema } from "./studio-postgres-schema.mjs";

export async function runImport(db, source, inventory, schema, snapshotSha, verifyTarget, progress = () => {}) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL statement_timeout TO '120s'");
    await db.query("SET LOCAL lock_timeout TO '5s'");
    await verifyTarget(db);
    await db.query("SELECT pg_advisory_xact_lock(192761531, 15)");
    const { rows: [state] } = await db.query(`
      SELECT to_regnamespace('studio')::text AS schema,
             to_regclass('studio.snapshot_import')::text AS receipt
    `);
    if (state.schema && !state.receipt) throw new Error("Studio target already contains an unmanaged schema");
    if (state.receipt) {
      const { rows } = await db.query("SELECT source_sha256 FROM studio.snapshot_import");
      if (rows.length !== 1 || rows[0].source_sha256 !== snapshotSha) {
        throw new Error("Studio target contains a different snapshot");
      }
    } else {
      for (const sql of schema.beforeImport) await db.query(sql);
      for (const [name, table] of Object.entries(inventory.tables)) {
        if (table.kind === "view") continue;
        const columns = table.columns.map((column) => quote(column.name)).join(", ");
        const select = source.prepare(`SELECT ${columns} FROM ${quote(name)}`);
        select.setReadBigInts(true);
        const rows = select.all();
        for (let offset = 0; offset < rows.length; offset += 200) {
          const batch = rows.slice(offset, offset + 200);
          const values = batch.flatMap((row) => Object.values(row));
          const slots = batch.map((row, index) => "(" + Object.keys(row)
            .map((_, col) => "$" + (index * table.columns.length + col + 1)).join(", ") + ")");
          await db.query(`INSERT INTO studio.${quote(name)} (${columns}) VALUES ${slots.join(", ")}`, values);
        }
        progress(name, rows.length);
      }
      for (const sql of schema.afterImport) await db.query(sql);
      // Advance the sequence using both the extant rows and the SQLite AUTOINCREMENT high-water mark.
      const sequence = source.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'edit_journal'");
      sequence.setReadBigInts(true);
      await db.query(`SELECT setval(pg_get_serial_sequence('studio.edit_journal', 'journal_seq'),
        greatest($1::bigint, (SELECT max(journal_seq) FROM studio.edit_journal), 1),
        $1::bigint > 0 OR EXISTS (SELECT 1 FROM studio.edit_journal))`, [sequence.get()?.seq ?? 0n]);
      await db.query(`CREATE TABLE studio.snapshot_import (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        source_sha256 text NOT NULL,
        imported_at timestamptz NOT NULL DEFAULT now()
      )`);
      await db.query("INSERT INTO studio.snapshot_import (source_sha256) VALUES ($1)", [snapshotSha]);
    }
    const fingerprints = await verifyFingerprints(db, inventory);
    await db.query("COMMIT");
    return { mode: state.receipt ? "reverified" : "imported", snapshotSha, fingerprints };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function verifyFingerprints(db, inventory) {
  const fingerprints = {};
  for (const [name, table] of Object.entries(inventory.tables)) {
    const columns = table.columns.map((column) => column.name);
    const { rows } = await db.query(`SELECT ${columns.map(quote).join(", ")} FROM studio.${quote(name)}`);
    for (const row of rows) {
      for (const column of table.columns) {
        if (column.type === "INTEGER" && row[column.name] !== null) row[column.name] = BigInt(row[column.name]);
      }
    }
    const actual = fingerprint(rows, columns);
    if (actual.count !== table.count || actual.sha256 !== table.sha256) throw new Error("Fingerprint mismatch: " + name);
    fingerprints[name] = actual;
  }
  return fingerprints;
}

async function neonTarget() {
  const connectionString = process.env.STUDIO_STAGING_MIGRATION_URL;
  const token = process.env.NEON_API_KEY;
  const project = process.env.STUDIO_NEON_PROJECT_ID;
  const branch = process.env.STUDIO_NEON_STAGING_BRANCH_ID;
  const website = process.env.WEBSITE_NEON_PROJECT_ID;
  const database = process.env.STUDIO_NEON_DATABASE;
  if (!connectionString || !token || !database || ![project, branch, website].every((id) => /^[a-z0-9-]+$/.test(id ?? "")) || project === website) {
    throw new Error("Separate verified website and Studio staging identities and credentials are required");
  }
  const url = new URL(connectionString);
  const safeParameters = new Map([["sslmode", new Set(["require", "verify-full"])],
    ["channel_binding", new Set(["require"])]]);
  const parameters = [...url.searchParams];
  if (url.protocol !== "postgresql:" || url.hash || (url.port && url.port !== "5432") ||
      parameters.some(([key, value]) => !safeParameters.get(key)?.has(value) || url.searchParams.getAll(key).length !== 1) ||
      decodeURIComponent(url.pathname.slice(1)) !== database) {
    throw new Error("Expected a direct staging PostgreSQL URL with TLS and without unsafe connection overrides");
  }
  const read = async (endpoint) => {
    const response = await fetch("https://console.neon.tech/api/v2/projects/" + project + endpoint, {
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Neon identity verification failed with status " + response.status);
    return response.json();
  };
  const [{ project: ownedProject }, { branch: info }, { endpoints }] = await Promise.all([
    read(""), read("/branches/" + branch), read("/endpoints"),
  ]);
  if (ownedProject.id !== project || ownedProject.name !== "hyper-almoatasem-catalog-studio" ||
      info.id !== branch || info.name !== "staging" || info.default || !info.parent_id || info.primary ||
      !endpoints.some((endpoint) => endpoint.project_id === project && endpoint.branch_id === branch &&
        endpoint.host === url.hostname && endpoint.type === "read_write")) {
    throw new Error("URL is outside the verified Studio staging branch");
  }
  url.search = "";
  const client = new pg.Client({
    connectionString: url.href, ssl: { rejectUnauthorized: true }, enableChannelBinding: true, connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return {
    client,
    async verify(db) {
      const { rows: [identity] } = await db.query(`SELECT current_database() AS database,
        current_setting('transaction_read_only') AS read_only`);
      if (identity.database !== database || identity.read_only !== "off") throw new Error("Wrong staging database or read-only connection");
    },
  };
}

async function main(mode, path, expectedSha, runtime) {
  if (!["dry-run", "local", "staging"].includes(mode) || !path || !expectedSha ||
      (mode === "local" && !runtime)) {
    throw new Error("Usage: studio-postgres-import.mjs <dry-run|local|staging> <frozen-vault-snapshot> <sha256> [PGlite module path]");
  }
  if (!/^studio-snapshot-/.test(resolve(path).split(/[\\/]/).at(-2))) throw new Error("Use a frozen vault snapshot");
  const sha = sha256(readFileSync(path));
  if (sha !== expectedSha) throw new Error("Frozen snapshot SHA-256 mismatch");
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const inventory = inspect(source);
    const schema = postgresSchema(inventory);
    if (mode === "dry-run") {
      console.log(JSON.stringify({ mode, sha, mappings: schema.mappings, tables: inventory.tables }, null, 2));
      return;
    }
    if (mode === "local") {
      const { PGlite } = await import(pathToFileURL(resolve(runtime)).href);
      const client = new PGlite();
      try {
        const startedAt = performance.now();
        const receipt = await runImport(client, source, inventory, schema, sha, async () => {}, (table, count) => {
          console.error(`Loaded ${table}: ${count}`);
        });
        const importMs = performance.now() - startedAt;
        const repeat = await runImport(client, source, inventory, schema, sha, async () => {});
        const recoveryAt = performance.now();
        const archive = await client.dumpDataDir("gzip");
        const restored = new PGlite({ loadDataDir: archive });
        try {
          await verifyFingerprints(restored, inventory);
          await verifyRestoredGuards(restored);
          console.log(JSON.stringify({
            ...receipt, target: "embedded PostgreSQL", repeat: repeat.mode, importMs,
            independentRestore: {
              bytes: archive.size,
              sha256: sha256(Buffer.from(await archive.arrayBuffer())),
              durationMs: performance.now() - recoveryAt,
              fingerprintsMatched: true,
              guardsVerified: ["journal update/delete/truncate", "V0 protection", "draft journal prerequisite"],
            },
          }, null, 2));
        } finally {
          await restored.close();
        }
      } finally {
        await client.close();
      }
      return;
    }
    const { client, verify } = await neonTarget();
    try {
      const receipt = await runImport(client, source, inventory, schema, sha, verify, (table, count) => {
        console.error(`Loaded ${table}: ${count}`);
      });
      console.log(JSON.stringify({ ...receipt, target: "Neon Studio staging" }, null, 2));
    } finally {
      await client.end();
    }
  } finally {
    source.close();
  }
}

async function verifyRestoredGuards(db) {
  const probes = [
    "UPDATE studio.edit_journal SET note = note WHERE journal_seq = (SELECT min(journal_seq) FROM studio.edit_journal)",
    "DELETE FROM studio.edit_journal WHERE journal_seq = (SELECT min(journal_seq) FROM studio.edit_journal)",
    "TRUNCATE studio.edit_journal",
    "UPDATE studio.catalog_versions SET name = name WHERE id = 'f2f03aad-261d-4596-bede-5d1a8a6f14cb'",
    "INSERT INTO studio.product_drafts SELECT min(id), 'note', 'verification-only', 'unrecorded', 1, 'verification-only' FROM studio.products",
  ];
  for (const sql of probes) {
    await db.query("BEGIN");
    let rejected = false;
    try {
      await db.query(sql);
    } catch (error) {
      rejected = error.code === "23514";
    } finally {
      await db.query("ROLLBACK");
    }
    if (!rejected) throw new Error("A restored Studio immutability or journal guard did not reject a verification probe");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(...process.argv.slice(2));
  } catch (error) {
    // PostgreSQL DETAIL may contain data values. Never include it in evidence logs.
    console.error("Import failed:", error.code ? `database error ${error.code}` : error.message);
    process.exitCode = 1;
  }
}
