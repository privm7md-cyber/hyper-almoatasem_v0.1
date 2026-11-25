// closure-db-counts.mjs — READ-ONLY production-DB identity snapshot for the closure report.
// Only SELECTs; never writes, never touches the e2e DB's data.
import "dotenv/config";
import { Client } from "pg";

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows[0].n;
const out = {
  activeCategories: await q("select count(*)::int n from categories where is_active"),
  activeProducts: await q("select count(*)::int n from products where is_active and deleted_at is null"),
  productImages: await q("select count(*)::int n from product_images"),
  activeProductsWithoutActiveCategory: await q(
    "select count(*)::int n from products p left join categories c on c.id = p.category_id where p.is_active and p.deleted_at is null and (c.id is null or c.is_active = false)",
  ),
  variantsOnActiveProducts: await q(
    "select count(*)::int n from product_variants v join products p on p.id = v.product_id where p.is_active and p.deleted_at is null and v.is_active",
  ),
};
await c.end();
console.log(JSON.stringify(out));