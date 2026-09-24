import "dotenv/config";
import { Client } from "pg";

// Full scratch verification (read-only). Connects ONLY to the given scratch
// database (guarded: name must end with `_scratch`, never hyper_almoatasem).
// Usage: node scripts/verify-scratch.mjs --db <name>
// Prints a JSON report { checks: [...], failures: n }.
const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");

if (dbFlag === -1 || !args[dbFlag + 1]) {
  console.error("USAGE: node scripts/verify-scratch.mjs --db <name>");
  process.exit(1);
}

const dbName = args[dbFlag + 1];

// Guarded: only explicitly allowlisted scratch databases (never production).
const ALLOWED_SCRATCH_DBS = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

if (!ALLOWED_SCRATCH_DBS.includes(dbName)) {
  console.error(`REFUSED_NOT_A_SCRATCH_DATABASE: ${dbName}`);
  process.exit(1);
}

const sourceUrl = process.env.MIGRATION_DATABASE_URL;

if (!sourceUrl) {
  throw new Error("MIGRATION_DATABASE_URL is missing");
}

const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${dbName}`;

const client = new Client({
  connectionString: targetUrl.toString(),
  connectionTimeoutMillis: 5000,
});

const checks = [];
const check = (name, expected, actual) => {
  checks.push({ name, expected, actual, pass: expected === actual });
};

try {
  await client.connect();
  const one = async (sql, params = []) =>
    (await client.query(sql, params)).rows[0];
  const rows = async (sql, params = []) =>
    (await client.query(sql, params)).rows;

  check(
    "tables",
    31,
    Number((await one(`SELECT count(*) AS n FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`)).n),
  );

  const views = await rows(`SELECT table_name FROM information_schema.views
    WHERE table_schema='public' ORDER BY 1`);
  checks.push({
    name: "view_product_stock_status",
    expected: "product_stock_status",
    actual: views.map((r) => r.table_name).join(","),
    pass: views.some((r) => r.table_name === "product_stock_status"),
  });

  const seqs = await rows(`SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema='public' ORDER BY 1`);
  checks.push({
    name: "sequence_order_number_seq",
    expected: "order_number_seq",
    actual: seqs.map((r) => r.sequence_name).join(","),
    pass: seqs.some((r) => r.sequence_name === "order_number_seq"),
  });

  check(
    "foreign_keys",
    39,
    Number((await one(`SELECT count(*) AS n FROM pg_constraint
       WHERE contype='f' AND connamespace='public'::regnamespace`)).n),
  );

  const fkActions = await rows(`SELECT CASE confdeltype
      WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT' END AS on_delete, count(*)::int AS n
    FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace
    GROUP BY 1 ORDER BY 1`);
  checks.push({
    name: "fk_on_delete_distribution_RESTRICT_CASCADE_SETNULL",
    expected: "31/7/1",
    actual: fkActions.map((r) => `${r.on_delete}=${r.n}`).join(" "),
    pass:
      fkActions.find((r) => r.on_delete === "RESTRICT")?.n === 31 &&
      fkActions.find((r) => r.on_delete === "CASCADE")?.n === 7 &&
      fkActions.find((r) => r.on_delete === "SET NULL")?.n === 1,
  });

  check(
    "check_constraints",
    155,
    Number((await one(`SELECT count(*) AS n FROM pg_constraint
       WHERE contype='c' AND connamespace='public'::regnamespace`)).n),
  );

  check(
    "partial_indexes",
    10,
    Number((await one(`SELECT count(*) AS n FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND i.indpred IS NOT NULL`)).n),
  );

  check(
    "triggers",
    22,
    Number((await one(`SELECT count(*) AS n FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal`)).n),
  );

  const infoTriggers = Number((await one(`SELECT count(*) AS n
    FROM information_schema.triggers WHERE trigger_schema='public'`)).n);
  checks.push({
    name: "information_schema_trigger_rows",
    expected: 23,
    actual: infoTriggers,
    pass: infoTriggers === 23,
  });

  const funcs = await rows(`SELECT p.proname FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('set_updated_at','prevent_category_cycle','check_cart_transition',
       'check_order_item_transition','check_replacement_transition',
       'check_order_status_audited')
    ORDER BY 1`);
  checks.push({
    name: "trigger_functions_6",
    expected: 6,
    actual: funcs.length,
    pass: funcs.length === 6,
  });

  const ext = await rows(`SELECT extname FROM pg_extension WHERE extname='pgcrypto'`);
  checks.push({
    name: "extension_pgcrypto",
    expected: 1,
    actual: ext.length,
    pass: ext.length === 1,
  });

  const gen = await one(`SELECT is_generated, generation_expression
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='inventory'
     AND column_name='available_quantity'`);
  checks.push({
    name: "generated_available_quantity",
    expected: "ALWAYS | (quantity - reserved_quantity)",
    actual: gen ? `${gen.is_generated} | ${gen.generation_expression}` : "MISSING",
    pass:
      !!gen &&
      gen.is_generated === "ALWAYS" &&
      /quantity\s*-\s*reserved_quantity/.test(gen.generation_expression || ""),
  });

  const inet = await one(`SELECT data_type, udt_name
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='audit_logs'
     AND column_name='ip_address'`);
  checks.push({
    name: "audit_logs_ip_address_inet",
    expected: "USER-DEFINED/inet",
    actual: inet ? `${inet.data_type}/${inet.udt_name}` : "MISSING",
    pass: !!inet && inet.udt_name === "inet",
  });

  // Zero business rows expected on a fresh scratch.
  const counts = await rows(`SELECT schemaname || '.' || relname AS t,
      n_live_tup::int AS n FROM pg_stat_user_tables ORDER BY 1`);
  const totalRows = counts.reduce((s, r) => s + r.n, 0);
  checks.push({
    name: "total_business_rows_zero",
    expected: 0,
    actual: totalRows,
    pass: totalRows === 0,
  });

  const failures = checks.filter((c) => !c.pass).length;
  const conn = await client.query(
    `SELECT current_database() AS db, current_user AS usr`,
  );
  console.log(
    JSON.stringify(
      { database: dbName, connection: conn.rows[0], failures, checks },
      null,
      2,
    ),
  );
  process.exitCode = failures === 0 ? 0 : 2;
} finally {
  await client.end().catch(() => {});
}
