// Fail-closed database target guard for mutation-heavy integration/test scripts.
//
// Primary and Scratch are denied unconditionally. The only permitted target is
// the dedicated disposable cluster provisioned by scripts/v1-ops-isolated.mjs
// (database hyper_v1_ops_disposable on 127.0.0.1:55449). Every check fails
// closed: an unset, malformed, remote, renamed, or re-ported target is refused
// before any connection is opened.
import path from "node:path";

export const PRIMARY_DATABASE = "hyper_almoatasem";
export const PRIMARY_SYSTEM_IDENTIFIER = "7687734853145036120";
export const SCRATCH_DATABASE = "hyper_almoatasem_scratch";
export const DISPOSABLE_DATABASE = "hyper_v1_ops_disposable";
export const DISPOSABLE_PORT = 55449;
export const DISPOSABLE_DATA_DIR = "_recovery/v1-ops/pgdata";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export class DatabaseGuardError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DatabaseGuardError";
    this.details = details;
  }
}

function parseTarget(url, context) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseGuardError(`[db-guard] ${context}: database URL is not valid; refusing to run.`);
  }
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname.toLowerCase(),
    port: Number(parsed.port || 5432),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

/** Validate a URL without connecting. Throws DatabaseGuardError on any non-disposable target. */
export function assertDisposableDatabaseUrl(url, { context = "script" } = {}) {
  if (!url) {
    throw new DatabaseGuardError(`[db-guard] ${context}: no database URL configured; refusing to run.`);
  }
  const target = parseTarget(url, context);
  if (!POSTGRES_PROTOCOLS.has(target.protocol)) {
    throw new DatabaseGuardError(`[db-guard] ${context}: unsupported database protocol "${target.protocol}"; refusing to run.`);
  }
  if (target.database === PRIMARY_DATABASE) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: Primary database "${PRIMARY_DATABASE}" is denied for mutating scripts.`,
      target,
    );
  }
  if (target.database === SCRATCH_DATABASE) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: Scratch database "${SCRATCH_DATABASE}" must be preserved and is denied for mutating scripts.`,
      target,
    );
  }
  if (!LOCAL_HOSTS.has(target.hostname)) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: host "${target.hostname}" is not a local disposable host; refusing to run.`,
      target,
    );
  }
  if (target.database !== DISPOSABLE_DATABASE || target.port !== DISPOSABLE_PORT) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: only "${DISPOSABLE_DATABASE}" on port ${DISPOSABLE_PORT} is allowed ` +
        `(got "${target.database}" on port ${target.port}); refusing to run.`,
      target,
    );
  }
  return target;
}

/**
 * Validate every configured database URL. If both DATABASE_URL and
 * V1_OPS_DATABASE_URL are present (the isolated runner sets both), both must
 * point at the disposable cluster so Prisma and the raw pg client cannot split
 * across databases.
 */
export function assertDisposableEnvironment({ context = "script", requireKeys = ["DATABASE_URL"] } = {}) {
  const checked = [];
  for (const key of ["DATABASE_URL", "V1_OPS_DATABASE_URL"]) {
    const value = process.env[key];
    if (!value) continue;
    checked.push({ key, ...assertDisposableDatabaseUrl(value, { context: `${context} (${key})` }) });
  }
  for (const key of requireKeys) {
    if (!process.env[key]) {
      throw new DatabaseGuardError(`[db-guard] ${context}: ${key} is required; refusing to run.`);
    }
  }
  if (checked.length === 0) {
    throw new DatabaseGuardError(`[db-guard] ${context}: no disposable database URL configured; refusing to run.`);
  }
  return checked;
}

/** Runtime proof after connect: database name, port, and (when readable) data directory. */
export async function assertDisposableConnection(client, { context = "script" } = {}) {
  const { rows } = await client.query(
    "select current_database() as database, inet_server_port() as port",
  );
  const row = rows[0];
  if (row.database !== DISPOSABLE_DATABASE) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: connected database "${row.database}" is not "${DISPOSABLE_DATABASE}".`,
      row,
    );
  }
  if (Number(row.port) !== DISPOSABLE_PORT) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: connected port ${row.port} is not the disposable port ${DISPOSABLE_PORT}.`,
      row,
    );
  }
  let dataDirectory = null;
  try {
    const dir = await client.query("select current_setting('data_directory') as data_directory");
    dataDirectory = dir.rows[0]?.data_directory ?? null;
  } catch {
    // Some app roles cannot read data_directory; database+port already fail closed.
  }
  if (dataDirectory) {
    const expected = path.resolve(DISPOSABLE_DATA_DIR);
    if (path.resolve(dataDirectory) !== expected) {
      throw new DatabaseGuardError(
        `[db-guard] ${context}: data directory "${dataDirectory}" is not the disposable directory.`,
        { ...row, dataDirectory },
      );
    }
  }
  return { database: row.database, port: Number(row.port), dataDirectory };
}

/** Explicit owner confirmation for the one intentionally Primary-targeted cleanup tool. */
export function assertPrimaryCleanupConfirmation(confirmation, { context = "script" } = {}) {
  if (confirmation !== PRIMARY_DATABASE) {
    throw new DatabaseGuardError(
      `[db-guard] ${context}: Primary cleanup requires --confirm-primary=${PRIMARY_DATABASE}.`,
    );
  }
}
