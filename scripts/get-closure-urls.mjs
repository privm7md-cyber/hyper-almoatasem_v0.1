import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cats = await c.query("SELECT id, slug, name FROM categories ORDER BY id LIMIT 5");
console.log('CATS', JSON.stringify(cats.rows));
const firstCat = cats.rows[0];
if (firstCat) {
  const subs = await c.query("SELECT id, slug, name, parent_id FROM categories WHERE parent_id=$1 ORDER BY id LIMIT 5", [firstCat.id]);
  console.log('SUBS of first', JSON.stringify(subs.rows));
}
const prods = await c.query("SELECT id, slug, name, category_id FROM products ORDER BY id LIMIT 5");
console.log('PRODS', JSON.stringify(prods.rows));
await c.end();
