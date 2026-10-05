// BA-B scale seed (scratch-only): deterministic Arabic grocery catalog for
// search/pagination/filter benchmark + behavior depth (20k products).
// Usage: node scripts/api/seed-bab-scale.mjs --db <scratch> [--count N] [--clean]
//   --clean removes every BA-B-SCALE row (products → variants → inventory →
//   codes → brands → categories, FK-safe order). Refuses non-scratch DBs.
// Deterministic: seeded RNG + fixed name pool, so runs are reproducible.
// Prints JSON, never secrets.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const countFlag = args.indexOf("--count");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const COUNT = countFlag === -1 ? 20000 : Number(args[countFlag + 1]);
const CLEAN = args.includes("--clean");

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const TAG = "BA-B-SCALE";
const CATS = ["ألبان", "بقوليات", "مشروبات", "خضار وفاكهة", "منظفات", "مخبوزات", "لحوم", "بقالة"];
const BRANDS = ["المراعي", "جهينة", "بيبسي", "كوكاكولا", "لونا", "ريجينا", "الشمعدان", "الدوار"];
const BASES = [
  "أرز بسمتي", "أرز مصري", "أرز", "سكر أبيض", "سكر بني", "سكر ناعم", "سكر", "دقيق فاخر",
  "دقيق", "مكرونة سباجيتي", "مكرونة", "زيت ذرة", "زيت عباد", "سمن بلدي", "شاي أحمد",
  "شاي", "قهوة تركي", "قهوة", "ملح طعام", "فلفل أسود", "كمون مطحون", "عدس أصفر",
  "عدس", "فول مدمس", "فول", "حمص الشام", "حمص", "جبنة رومي", "جبنة بيضاء", "جبنة",
  "زبدة طبيعي", "لبن كامل", "لبن", "زبادي", "بيض بلدي", "عسل نحل", "مربى فراولة",
  "طحينة", "عجوة", "تمر سكري", "شوفان", "كورن فليكس", "بسكويت سادة", "شيبسي ملح",
  "بيبسي", "كوكاكولا", "عصير مانجو", "عصير برتقال", "تفاح أحمر", "موز", "بطاطس",
  "بطاطس شيبسي", "طماطم", "بصل أحمر", "ثوم", "جزر", "خيار", "فلفل رومي", "باذنجان",
  "كوسة", "سبانخ", "ملوخية", "فراخ بيضاء", "لحمة بقري", "سمك بلطي", "تونة",
  "صابون غار", "شامبو", "معجون أسنان", "مناديل", "أرز بالشعرية",
];
const SUFFIX = ["", " فاخر", " اقتصادي", " كبير", " صغير", " عرض خاص", " 1كجم", " 500جم"];

// Deterministic mulberry32.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
    process.exit(1);
  }
  const u = new URL(process.env.MIGRATION_DATABASE_URL);
  u.pathname = `/${dbName}`;
  const db = new Client({ connectionString: u.toString(), connectionTimeoutMillis: 8000 });
  await db.connect();
  try {
    if (CLEAN) {
      const r = await db.query(`SELECT id::text AS id FROM categories WHERE name LIKE $1`, [`${TAG}%`]);
      const catIds = r.rows.map((x) => x.id);
      let products = 0;
      if (catIds.length > 0) {
        const pr = await db.query(`SELECT id::text AS id FROM products WHERE category_id = ANY($1::uuid[])`, [catIds]);
        const pIds = pr.rows.map((x) => x.id);
        products = pIds.length;
        if (pIds.length > 0) {
          const vr = await db.query(`SELECT id::text AS id FROM product_variants WHERE product_id = ANY($1::uuid[])`, [pIds]);
          const vIds = vr.rows.map((x) => x.id);
          if (vIds.length > 0) {
            await db.query(`DELETE FROM inventory WHERE product_variant_id = ANY($1::uuid[])`, [vIds]);
            await db.query(`DELETE FROM product_codes WHERE product_variant_id = ANY($1::uuid[])`, [vIds]);
            await db.query(`DELETE FROM product_price_history WHERE product_variant_id = ANY($1::uuid[])`, [vIds]);
            await db.query(`DELETE FROM product_variants WHERE id = ANY($1::uuid[])`, [vIds]);
          }
          await db.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [pIds]);
        }
        await db.query(`DELETE FROM brands WHERE name LIKE $1`, [`${TAG}%`]);
        await db.query(`DELETE FROM categories WHERE name LIKE $1`, [`${TAG}%`]);
      }
      console.log(JSON.stringify({ db: dbName, cleaned: true, products }));
      return;
    }
    const rand = rng(20260930);

    // Categories + brands first (fixed small sets).
    const catIds = [];
    for (let i = 0; i < CATS.length; i++) {
      const id = randomUUID();
      catIds.push(id);
      await db.query(
        `INSERT INTO categories (id, name, slug, is_active, sort_order) VALUES ($1, $2, $3, TRUE, $4)`,
        [id, `${TAG} ${CATS[i]}`, `bab-scale-cat-${i}`, i],
      );
    }
    const brandIds = [];
    for (let i = 0; i < BRANDS.length; i++) {
      const id = randomUUID();
      brandIds.push(id);
      await db.query(`INSERT INTO brands (id, name, slug, is_active) VALUES ($1, $2, $3, TRUE)`,
        [id, `${TAG} ${BRANDS[i]}`, `bab-scale-brand-${i}`]);
    }
    // Products in batches of 1000 (multi-row VALUES).
    let made = 0;
    let seq = 0;
    const chunk = 1000;
    const variantRows = [];
    while (made < COUNT) {
      const n = Math.min(chunk, COUNT - made);
      const pVals = [];
      const pIds = [];
      for (let i = 0; i < n; i++, seq++) {
        const id = randomUUID();
        const base = BASES[seq % BASES.length];
        const cyc = Math.floor(seq / BASES.length);
        const name = cyc === 0 ? `${base}` : `${base} ${SUFFIX[cyc % SUFFIX.length]} ${Math.floor(cyc / SUFFIX.length) || ""}`.trim() + ` ${seq}`;
        const slug = `bab-scale-p-${seq}`;
        const cat = catIds[seq % catIds.length];
        const brand = seq % 7 === 0 ? null : brandIds[seq % brandIds.length];
        const inactive = seq % 20 === 19 ? "FALSE" : "TRUE";
        // Deliberately OLDER than any fixture (400d back): scale rows sort
        // after real fixtures in newest-first lists, so suites assuming
        // fixture-first pages keep working with scale present.
        const created = `now() - interval '400 days' - interval '${seq} minutes'`;
        pVals.push(`('${id}','${name.replace(/'/g, "''")}','${slug}','${cat}',${brand ? `'${brand}'` : "NULL"},'PIECE','PIECE',NULL,${inactive},${created},${created})`);
        pIds.push({ id, seq });
      }
      await db.query(`INSERT INTO products (id, name, slug, category_id, brand_id, product_type, unit, sale_step_grams, is_active, created_at, updated_at) VALUES ${pVals.join(",")}`);
      made += n;
      // One variant + inventory + (sometimes) code per product, batched.
      const vVals = [];
      const vMeta = [];
      for (const { id: pid, seq: s } of pIds) {
        const vid = randomUUID();
        const price = (5 + Math.floor(rand() * 495) + (rand() < 0.5 ? 0.5 : 0.0)).toFixed(2);
        const inactive = s % 20 === 19;
        vVals.push(`('${vid}','${pid}','عبوة','1','PIECE',${price},NULL,NULL,${inactive ? "FALSE" : "TRUE"})`);
        vMeta.push({ vid, seq: s, price });
      }
      await db.query(`INSERT INTO product_variants (id, product_id, name, size_value, size_unit, price, compare_at_price, cost_price, is_active) VALUES ${vVals.join(",")}`);
      const iVals = [];
      const cVals = [];
      for (const { vid, seq: s } of vMeta) {
        const qty = s % 7 === 6 ? 0 : 10 + (s % 90);
        iVals.push(`('${randomUUID()}','${vid}',${qty}.000,0.000)`);
        if (s % 3 === 0) cVals.push(`('${randomUUID()}','${vid}','622${String(10000000 + s).slice(0, 8)}','BARCODE',FALSE)`);
      }
      await db.query(`INSERT INTO inventory (id, product_variant_id, quantity, reserved_quantity) VALUES ${iVals.join(",")}`);
      if (cVals.length > 0) {
        await db.query(`INSERT INTO product_codes (id, product_variant_id, code, type, is_primary) VALUES ${cVals.join(",")}`);
      }
      variantRows.push(...vMeta);
    }
    console.log(JSON.stringify({ db: dbName, seeded: true, products: made, variants: variantRows.length }));
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`SEED_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
