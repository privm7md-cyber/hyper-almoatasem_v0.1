import { createHash } from "node:crypto";
import { constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Preserve SQLite value types. Length-prefix rows so record boundaries cannot collide.
export function fingerprint(rows, columns) {
  const records = rows.map((row) => JSON.stringify(columns.map((column) => {
    const value = row[column];
    if (value instanceof Uint8Array) return ["blob", Buffer.from(value).toString("base64")];
    return [typeof value, typeof value === "bigint" ? value.toString() : value];
  }))).sort();
  const hash = createHash("sha256");
  for (const record of records) hash.update(Buffer.byteLength(record) + ":").update(record);
  return { count: records.length, sha256: hash.digest("hex") };
}

export function inspect(db) {
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("SQLite integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").get()) throw new Error("SQLite has foreign key violations");
  const migrations = db.prepare("SELECT version, name FROM migrations ORDER BY version").all();
  if (migrations.length !== 15 || migrations.some((migration, i) => migration.version !== i + 1)) {
    throw new Error("Expected exactly Studio migrations 001 through 015");
  }
  const baseline = db.prepare("SELECT id FROM catalog_versions WHERE id = ?")
    .get("f2f03aad-261d-4596-bede-5d1a8a6f14cb");
  if (!baseline) throw new Error("Expected Studio V0 is missing");

  const listed = new Map(db.prepare("PRAGMA main.table_list").all().map((row) => [row.name, row.type]));
  const schema = db.prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type, name")
    .all().filter((entry) => !entry.name.startsWith("sqlite_")).map((entry) => ({
      ...entry,
      kind: listed.get(entry.name) ?? entry.type,
    }));
  const tables = {};
  for (const entry of schema) {
    if (!["table", "view", "virtual"].includes(entry.kind)) continue;
    const name = quote(entry.name);
    const columns = db.prepare("PRAGMA table_xinfo(" + name + ")").all().filter((column) => column.hidden === 0);
    const statement = db.prepare("SELECT " + columns.map((column) => quote(column.name)).join(", ") + " FROM " + name);
    statement.setReadBigInts(true);
    tables[entry.name] = {
      kind: entry.kind,
      columns,
      foreignKeys: db.prepare("PRAGMA foreign_key_list(" + name + ")").all(),
      ...fingerprint(statement.all(), columns.map((column) => column.name)),
    };
  }
  const reviewProvenance = db.prepare(`
    SELECT coalesce(p.classification, 'UNVERIFIED') AS classification, count(*) AS records
    FROM review_progress AS r LEFT JOIN session_provenance AS p ON p.session_id = r.session_id
    GROUP BY 1 ORDER BY 1`).all();
  const journalProvenance = db.prepare(`
    SELECT coalesce(p.classification, 'UNVERIFIED') AS classification, count(*) AS records
    FROM edit_journal AS j LEFT JOIN session_provenance AS p ON p.session_id = j.session_id
    GROUP BY 1 ORDER BY 1`).all();
  return { baselineId: baseline.id, migrations, schema, tables, reviewProvenance, journalProvenance };
}

async function main(sourcePath, vaultRoot) {
  if (!sourcePath || !vaultRoot) throw new Error("Usage: node sqlite-snapshot.mjs <owner.sqlite3> <private-backup-directory>");
  mkdirSync(vaultRoot, { recursive: true });
  const vault = mkdtempSync(join(resolve(vaultRoot), "studio-snapshot-"));
  const snapshot = join(vault, "studio.sqlite3");
  const source = new DatabaseSync(resolve(sourcePath), { readOnly: true, timeout: 8000 });
  try {
    // SQLite's online backup API includes committed WAL data without requesting a checkpoint.
    await backup(source, snapshot);
  } finally {
    source.close();
  }
  const sha = sha256(readFileSync(snapshot));
  const restoreDir = mkdtempSync(join(tmpdir(), "studio-restore-"));
  try {
    const restorePath = join(restoreDir, "studio.sqlite3");
    copyFileSync(snapshot, restorePath, constants.COPYFILE_EXCL);
    const restoredSha = sha256(readFileSync(restorePath));
    if (restoredSha !== sha) throw new Error("Restored SQLite file differs from snapshot");
    const restored = new DatabaseSync(restorePath, { readOnly: true });
    try {
      const inventory = inspect(restored);
      console.log(JSON.stringify({
        createdAt: new Date().toISOString(),
        sourceMode: "read-only SQLite online backup",
        snapshot,
        sha256: sha,
        independentRestore: { sha256: restoredSha, integrityCheck: "ok", foreignKeyViolations: 0 },
        ...inventory,
      }, null, 2));
    } finally {
      restored.close();
    }
  } finally {
    // The restore directory was just allocated. Only remove the known disposable files.
    for (const suffix of ["", "-wal", "-shm"]) rmSync(join(restoreDir, "studio.sqlite3" + suffix), { force: true });
    rmdirSync(restoreDir);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2], process.argv[3]);
}
