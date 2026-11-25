// Read-only Phase D/E safety and baseline inspection.
// Loads the repository's configured Primary connection, prints no credentials,
// and performs SELECT/metadata queries only.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const many = async (sql, params = []) => (await db.query(sql, params)).rows;

const identity = await one(`
  SELECT current_database() AS database,
         current_user AS current_user,
         session_user AS session_user,
         current_setting('server_version') AS server_version,
         inet_server_addr()::text AS server_address,
         inet_server_port() AS server_port
`);

const privileges = await one(`
  SELECT
    has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
    has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
    has_table_privilege(current_user, 'public.brands', 'SELECT') AS brands_select,
    has_table_privilege(current_user, 'public.brands', 'INSERT') AS brands_insert,
    has_table_privilege(current_user, 'public.brands', 'UPDATE') AS brands_update,
    has_table_privilege(current_user, 'public.brands', 'DELETE') AS brands_delete,
    has_table_privilege(current_user, 'public.products', 'SELECT') AS products_select,
    has_table_privilege(current_user, 'public.products', 'UPDATE') AS products_update,
    has_table_privilege(current_user, 'public.product_variants', 'SELECT') AS variants_select,
    has_table_privilege(current_user, 'public.product_variants', 'UPDATE') AS variants_update,
    has_table_privilege(current_user, 'public.audit_logs', 'INSERT') AS audit_insert,
    has_table_privilege(current_user, 'public.audit_logs', 'UPDATE') AS audit_update,
    has_table_privilege(current_user, 'public.audit_logs', 'DELETE') AS audit_delete
`);

const counts = await one(`
  SELECT
    (SELECT COUNT(*)::int FROM brands) AS brands,
    (SELECT COUNT(*)::int FROM brands WHERE deleted_at IS NULL AND is_active) AS active_brands,
    (SELECT COUNT(*)::int FROM products) AS products,
    (SELECT COUNT(*)::int FROM products WHERE brand_id IS NOT NULL) AS branded_products,
    (SELECT COUNT(*)::int FROM product_variants WHERE deleted_at IS NULL) AS live_variants,
    (SELECT COUNT(*)::int FROM product_variants WHERE deleted_at IS NULL AND size_unit IS NULL) AS missing_size_unit,
    (SELECT COUNT(*)::int FROM product_variants WHERE deleted_at IS NULL AND size_value IS NULL) AS missing_size_value,
    (SELECT COUNT(*)::int FROM product_variants WHERE deleted_at IS NULL AND ((size_unit IS NULL) <> (size_value IS NULL))) AS partial_size_pairs,
    (SELECT COUNT(*)::int FROM product_variants WHERE deleted_at IS NULL AND size_unit IS NOT NULL AND size_unit NOT IN ('PIECE','KG','GRAM','LITER','ML')) AS unsupported_size_units,
    (SELECT COUNT(*)::int FROM (
       SELECT product_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
       FROM product_variants
       WHERE deleted_at IS NULL
       GROUP BY product_id, lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
       HAVING COUNT(*) > 1
     ) d) AS duplicate_variant_groups,
    (SELECT COUNT(*)::int
       FROM products
      WHERE product_type = 'PIECE'
        AND name ~* '[0-9٠-٩۰-۹]+([.,][0-9٠-٩۰-۹]+)?[[:space:]]*(جم|جرام|غرام|كجم|كيلو|كيلوجرام|kg|g)([^[:alpha:]]|$)') AS piece_names_with_gram_or_kg,
    (SELECT COUNT(*)::int FROM audit_logs WHERE entity_type = 'brands') AS brand_audit_rows,
    (SELECT COUNT(*)::int FROM audit_logs WHERE entity_type = 'product_variants' AND action = 'variants.update') AS variant_update_audit_rows
`);

const brandColumns = await many(`
  SELECT column_name, data_type, is_nullable, character_maximum_length
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'brands'
  ORDER BY ordinal_position
`);

const brandConstraints = await many(`
  SELECT c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid, true) AS definition
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND t.relname = 'brands'
  ORDER BY c.conname
`);

const brandIndexes = await many(`
  SELECT indexname AS name, indexdef AS definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'brands'
  ORDER BY indexname
`);

const relevantTriggers = await many(`
  SELECT event_object_table AS table_name, trigger_name, action_timing,
         event_manipulation, action_statement
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
    AND (event_object_table IN ('brands', 'products', 'product_variants', 'audit_logs')
      OR trigger_name ILIKE '%audit%' OR trigger_name ILIKE '%redact%')
  ORDER BY event_object_table, trigger_name, event_manipulation
`);

const h2Objects = await many(`
  SELECT routine_name, routine_type, security_type
  FROM information_schema.routines
  WHERE routine_schema = 'public'
    AND (routine_name ILIKE '%audit%' OR routine_name ILIKE '%redact%' OR routine_name ILIKE '%privacy%')
  ORDER BY routine_name
`);

const duplicateBrandNames = await many(`
  SELECT lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS normalized_name,
         COUNT(*)::int AS count,
         array_agg(name ORDER BY name) AS stored_names
  FROM brands
  WHERE deleted_at IS NULL
  GROUP BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  HAVING COUNT(*) > 1
  ORDER BY normalized_name
`);

const report = {
  generatedAt: new Date().toISOString(),
  mode: "READ_ONLY",
  identity,
  expectedPrimary: "hyper_almoatasem",
  identityMatchesExpectedPrimary: identity.database === "hyper_almoatasem",
  privileges,
  counts,
  duplicateBrandNames,
  brandSchema: { columns: brandColumns, constraints: brandConstraints, indexes: brandIndexes },
  relevantTriggers,
  h2Objects,
};

const text = `${JSON.stringify(report, null, 2)}\n`;
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
if (outPath) writeFileSync(outPath, text, "utf8");
process.stdout.write(text);
await db.end();
