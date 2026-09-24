// Auth structure tests (read-only, scratch-only): baseline regression +
// new auth objects. Usage: node scripts/auth/t-structure.mjs --db <name>
// NOTE: pg returns counts as strings — every count is wrapped in Number().
// The auth scratch also carries _prisma_migrations (resolve-marked for seed),
// hence 35 tables total (31 baseline + 3 auth + 1 history).
import "dotenv/config";
import { Client } from "pg";

const dbName = process.argv[process.argv.indexOf("--db") + 1];
const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];
if (!ALLOWED.includes(dbName)) {
  console.error(`REFUSED: ${dbName}`);
  process.exit(1);
}
const url = new URL(process.env.MIGRATION_DATABASE_URL);
url.pathname = `/${dbName}`;
const c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 8000 });

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass, detail });
const N = async (sql, p = []) => Number((await c.query(sql, p)).rows[0].n);
try {
  await c.connect();
  await c.query("SET default_transaction_read_only TO on");
  const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
  const NS = `AND connamespace='public'::regnamespace`;
  const AUTH_AND_HIST = `('admin_sessions','admin_auth_tokens','admin_auth_rate_limits','_prisma_migrations')`;
  // Baseline regression (frozen counts must be intact).
  t("tables_total_35", (await N(`SELECT count(*) n FROM pg_tables WHERE schemaname='public'`)) === 35);
  t("baseline_tables_31", (await N(`SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ${AUTH_AND_HIST}`)) === 31);
  t("fks_41", (await N(`SELECT count(*) n FROM pg_constraint WHERE contype='f' ${NS}`)) === 41);
  t("checks_165", (await N(`SELECT count(*) n FROM pg_constraint WHERE contype='c' ${NS}`)) === 165);
  t("triggers_23", (await N(`SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`)) === 23);
  t("functions_still_6", (await N(`SELECT count(*) n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('set_updated_at','prevent_category_cycle','check_cart_transition','check_order_item_transition','check_replacement_transition','check_order_status_audited')`)) === 6);
  t("view_intact", (await N(`SELECT count(*) n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND c.relname='product_stock_status'`)) === 1);
  t("sequence_intact", (await N(`SELECT count(*) n FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='order_number_seq'`)) === 1);
  t("pgcrypto_intact", (await N(`SELECT count(*) n FROM pg_extension WHERE extname='pgcrypto'`)) === 1);
  // New auth objects.
  t("users_auth_columns", (await N(`SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('password_hash','failed_login_attempts','locked_until')`)) === 3);
  t("sessions_table", (await N(`SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND tablename='admin_sessions'`)) === 1);
  t("tokens_table", (await N(`SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND tablename='admin_auth_tokens'`)) === 1);
  t("ratelimit_table", (await N(`SELECT count(*) n FROM pg_tables WHERE schemaname='public' AND tablename='admin_auth_rate_limits'`)) === 1);
  t("sessions_token_uq_as_index", (await N(`SELECT count(*) n FROM pg_class WHERE relname='admin_sessions_token_hash_key' AND relkind='i'`)) === 1, "Prisma renders @unique as unique index");
  t("tokens_token_uq_as_index", (await N(`SELECT count(*) n FROM pg_class WHERE relname='admin_auth_tokens_token_hash_key' AND relkind='i'`)) === 1, "Prisma renders @unique as unique index");
  t("sessions_user_idx", (await N(`SELECT count(*) n FROM pg_class WHERE relname='idx_sessions_user'`)) === 1);
  t("sessions_expiry_idx", (await N(`SELECT count(*) n FROM pg_class WHERE relname='idx_sessions_expiry'`)) === 1);
  t("tokens_user_idx", (await N(`SELECT count(*) n FROM pg_class WHERE relname='idx_tokens_user'`)) === 1);
  t("sessions_user_live_partial", (await N(`SELECT count(*) n FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='idx_sessions_user_live' AND i.indpred IS NOT NULL`)) === 1);
  t("rate_trigger_reuse", (await N(`SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='admin_auth_rate_limits' AND t.tgname='trg_rate_limits_updated_at' AND NOT t.tgisinternal`)) === 1);
  t("sessions_created_ip_inet", ((await one(`SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) typ FROM pg_attribute a JOIN pg_class cl ON cl.oid=a.attrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND cl.relname='admin_sessions' AND a.attname='created_ip'`)) || {}).typ === "inet");
  t("sessions_fk_restrict", ((await one(`SELECT confdeltype d, confupdtype u FROM pg_constraint WHERE conname='admin_sessions_user_id_fkey'`)) || {}).d === "r");
  t("tokens_fk_restrict", ((await one(`SELECT confdeltype d FROM pg_constraint WHERE conname='admin_auth_tokens_user_id_fkey'`)) || {}).d === "r");
  const failures = results.filter((r) => !r.pass).length;
  console.log(JSON.stringify({ database: dbName, failures, results }, null, 2));
  process.exitCode = failures === 0 ? 0 : 2;
} finally {
  await c.end().catch(() => {});
}
