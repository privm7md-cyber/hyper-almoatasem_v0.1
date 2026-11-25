import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
import pg from 'pg';
const { Client } = pg;
const u = process.env.DATABASE_URL;
const c = new Client({ connectionString: u });
await c.connect();
const id = await c.query('SELECT current_database() as db, current_user as usr, inet_server_port()::text as port');
console.log(JSON.stringify(id.rows, null, 2));
const tables = ['products','categories','product_images','product_variants'];
for (const t of tables) {
  try {
    const r = await c.query(`SELECT count(*)::text as n FROM ${t}`);
    console.log(t, r.rows[0].n);
  } catch(e) { console.log(t, 'ERR', e.message); }
}
try {
  const r = await c.query("SELECT count(*)::text as n FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)");
  console.log('orphan_products_no_variant', r.rows[0].n);
} catch(e){ console.log('orphan ERR', e.message); }
// empty categories
try {
  const r = await c.query("SELECT count(*)::text as n FROM categories c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id)");
  console.log('empty_categories', r.rows[0].n);
} catch(e){ console.log('emptycat ERR', e.message); }
// image: check url column existence
try {
  const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='product_images' ORDER BY ordinal_position");
  console.log('product_images_columns', r.rows.map(x=>x.column_name).join(','));
} catch(e){ console.log(e.message); }
await c.end();
