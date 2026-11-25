// Read-only evidence. No customer data, secrets, seeds, or worker mutations.
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';
registerHooks({ resolve(s, c, next) {
  if (s.startsWith('@/')) return next(pathToFileURL(path.resolve('src', s.slice(2) + '.ts')).href, c);
  return next(s, c);
}});
const env = { ...dotenv.parse(fs.readFileSync('.env')), ...dotenv.parse(fs.readFileSync('.env.local')) };
const url = new URL(env.DATABASE_URL);
if (url.pathname !== '/hyper_almoatasem' || !['localhost','127.0.0.1'].includes(url.hostname)) throw Error('Primary identity mismatch');
url.searchParams.set('options', '-c default_transaction_read_only=on');
const c = new Client({ connectionString: url.toString() });
await c.connect();
try {
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const { auditCatalogDataQuality } = await import('../src/lib/catalog/data-quality.ts');
  const adapter = { async $queryRaw(parts, ...values) {
    return (await c.query(parts.reduce((sql, p, i) => sql + (i ? '$' + i : '') + p, ''), values)).rows;
  }};
  const identity = (await c.query("SELECT current_database() db, current_user role, current_setting('transaction_read_only') read_only, inet_server_port() port")).rows[0];
  const catalog = await auditCatalogDataQuality(adapter);
  const schema = (await c.query(`SELECT
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') tables,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) triggers,
    (SELECT count(*)::int FROM delivery_zones) delivery_zones,
    (SELECT count(*)::int FROM audit_logs WHERE entity_type='delivery_zones') delivery_audit_events,
    (SELECT count(*)::int FROM audit_logs) audit_rows`)).rows[0];
  const settings = (await c.query("SELECT key,value_text FROM store_settings WHERE key LIKE 'delivery.%' ORDER BY key")).rows;
  const fingerprints = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('products','product_variants','product_codes','inventory','product_images','categories','brands','delivery_zones') ORDER BY tablename`)).rows;
  for (const t of fingerprints) t.fingerprint = (await c.query(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY id),'')) digest FROM public.${t.tablename} t`)).rows[0].digest;
  await c.query('COMMIT');
  const result = { capturedAt: new Date().toISOString(), identity, schema, settings, catalog, fingerprints };
  fs.mkdirSync('_recovery/v1-ops/evidence', { recursive:true });
  fs.writeFileSync(`_recovery/v1-ops/evidence/primary-${process.argv[2] || 'before'}.json`, JSON.stringify(result,null,2));
  console.log(JSON.stringify({ identity, schema, output: 'Primary read-only evidence saved' }));
} finally { await c.end(); }
