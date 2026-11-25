#!/usr/bin/env node
// ============================================================================
// SCHEMA PARITY COMPARATOR — catalog-to-catalog, privilege-independent.
//
// WHY: `prisma migrate diff --from-config-datasource` performs its own
// introspection, which is privilege-sensitive — against a database whose
// tables are owned by another role the introspected shape comes back
// incomplete and the diff is misleading. This comparator reads pg_catalog
// directly (visibility of catalog rows does not depend on table
// privileges), so it compares what the databases ACTUALLY contain.
//
// Compares, per database: tables, columns (name/type/nullable/default),
// primary keys, unique constraints, foreign keys, indexes (name + definition),
// CHECK constraints (name + expression), triggers (name + definition),
// functions (name + argument types), sequences, views, and extensions.
//
// Usage:
//   node scripts/verify-schema-parity.mjs --a <url> --b <url> [--label-a x] [--label-b y]
//   [--ignore-table <name>]... [--json]
//
// Exit code 0 when the two schemas are equivalent (modulo ignored tables),
// 2 when they differ, 1 on error. No writes are performed on either side.
// ============================================================================
import { Client } from "pg";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const all = (name) =>
  args.reduce((acc, a, i) => (a === `--${name}` ? [...acc, args[i + 1]] : acc), []);

const urlA = flag("a");
const urlB = flag("b");
const labelA = flag("label-a") || "A";
const labelB = flag("label-b") || "B";
const ignoreTables = new Set(all("ignore-table"));

if (!urlA || !urlB) {
  console.error("USAGE: node scripts/verify-schema-parity.mjs --a <url> --b <url> [--ignore-table <name>]");
  process.exit(1);
}

/** Full schema signature of one database, read from pg_catalog. */
async function signature(url) {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await c.connect();
  const q = async (sql) => (await c.query(sql)).rows;
  const id = await q("SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version");

  const tables = await q(`
    SELECT c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND c.relname NOT LIKE 'pg_%'
     ORDER BY 1`);

  const columns = await q(`
    SELECT c.relname AS table, a.attname AS name,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr,
           a.attidentity <> '' AS identity,
           a.attgenerated <> '' AS generated
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1, 2`);

  const pks = await q(`
    SELECT c.relname AS table, con.conname AS name,
           pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'p' AND n.nspname = 'public'
     ORDER BY 1, 2`);

  const uniques = await q(`
    SELECT c.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'u' AND n.nspname = 'public'
     ORDER BY 1, 2`);

  const fks = await q(`
    SELECT c.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public'
     ORDER BY 1, 2`);

  const checks = await q(`
    SELECT c.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE con.contype = 'c' AND n.nspname = 'public'
     ORDER BY 1, 2`);

  const indexes = await q(`
    SELECT c.relname AS table, i.relname AS name, pg_get_indexdef(x.indexrelid) AS def
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY 1, 2`);

  const triggers = await q(`
    SELECT c.relname AS table, t.tgname AS name,
           pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ORDER BY 1, 2`);

  const functions = await q(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
     ORDER BY 1, 2`);

  const sequences = await q(`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1`);

  const views = await q(`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v' ORDER BY 1`);

  const extensions = await q(`SELECT extname AS name FROM pg_extension ORDER BY 1`);

  await c.end();

  const drop = (rows, keys) => {
    const set = new Set(rows.map((r) => keys.map((k) => r[k]).join("|")));
    for (const t of ignoreTables) {
      for (const s of [...set]) if (s.startsWith(`${t}|`)) set.delete(s);
    }
    return [...set].sort();
  };

  return {
    identity: id[0],
    counts: {
      tables: tables.length,
      columns: columns.length,
      primary_keys: pks.length,
      uniques: uniques.length,
      foreign_keys: fks.length,
      checks: checks.length,
      indexes: indexes.length,
      triggers: triggers.length,
      functions: functions.length,
      sequences: sequences.length,
      views: views.length,
      extensions: extensions.length,
    },
    tables: tables.map((r) => r.name).filter((n) => !ignoreTables.has(n)).sort(),
    columns: drop(columns, ["table", "name"]),
    primary_keys: drop(pks, ["table", "name"]),
    uniques: drop(uniques, ["table", "name"]),
    foreign_keys: drop(fks, ["table", "name"]),
    checks: drop(checks, ["table", "name"]),
    indexes: drop(indexes, ["table", "name"]),
    triggers: drop(triggers, ["table", "name"]),
    functions: drop(functions, ["name", "args"]),
    sequences: sequences.map((r) => r.name).sort(),
    views: views.map((r) => r.name).sort(),
    extensions: extensions.map((r) => r.name).sort(),
  };
}

const diffSet = (a, b) => ({
  onlyInA: a.filter((x) => !b.includes(x)),
  onlyInB: b.filter((x) => !a.includes(x)),
});

const main = async () => {
  const A = await signature(urlA);
  const B = await signature(urlB);

  const sections = [
    "tables", "columns", "primary_keys", "uniques", "foreign_keys",
    "checks", "indexes", "triggers", "functions", "sequences", "views", "extensions",
  ];
  const differences = {};
  let totalDiffs = 0;
  for (const s of sections) {
    const d = diffSet(A[s], B[s]);
    if (d.onlyInA.length || d.onlyInB.length) {
      differences[s] = d;
      totalDiffs += d.onlyInA.length + d.onlyInB.length;
    }
  }

  const report = {
    a: { label: labelA, identity: A.identity, counts: A.counts },
    b: { label: labelB, identity: B.identity, counts: B.counts },
    equivalent: totalDiffs === 0,
    difference_count: totalDiffs,
    differences,
    ignored_tables: [...ignoreTables],
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = totalDiffs === 0 ? 0 : 2;
};

main().catch((e) => {
  console.error(`FATAL: ${e?.message ?? e}`);
  process.exit(1);
});
