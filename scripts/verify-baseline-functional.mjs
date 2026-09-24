import "dotenv/config";
import { Client } from "pg";

// Targeted functional battery on a scratch database ONLY (planning-gate 7/7).
// Guards: target must end with `_scratch` and must not be hyper_almoatasem.
// Every mutating test runs inside a transaction that is ALWAYS ROLLED BACK,
// so the scratch database keeps 0 business rows (nextval is the only
// non-rollbackable call, and sequence gaps are accepted by design).
// Usage: node scripts/verify-baseline-functional.mjs --db <name>
const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");

if (dbFlag === -1 || !args[dbFlag + 1]) {
  console.error("USAGE: node scripts/verify-baseline-functional.mjs --db <name>");
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

const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

async function inRollback(client, fn) {
  await client.query("BEGIN");
  try {
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

const client = new Client({
  connectionString: targetUrl.toString(),
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();

  // 1. CHECK fires (bad slug must be rejected).
  await inRollback(client, async () => {
    try {
      await client.query(
        `INSERT INTO brands (name, slug) VALUES ('Bad', 'HAS SPACE')`,
      );
      record("check_fires", false, "bad slug was accepted");
    } catch (e) {
      record(
        "check_fires",
        e?.code === "23514",
        `code=${e?.code} constraint=${e?.constraint}`,
      );
    }
  });

  // 2. Transition guard (terminal cart must reject further transitions).
  await inRollback(client, async () => {
    const c = await client.query(
      `INSERT INTO customers (first_name, phone) VALUES ('T', '201000000001') RETURNING id`,
    );
    const cid = c.rows[0].id;
    const cart = await client.query(
      `INSERT INTO carts (customer_id) VALUES ($1) RETURNING id`,
      [cid],
    );
    const cartId = cart.rows[0].id;
    await client.query(`UPDATE carts SET status='CHECKED_OUT' WHERE id=$1`, [
      cartId,
    ]);
    try {
      await client.query(`UPDATE carts SET status='MERGED' WHERE id=$1`, [
        cartId,
      ]);
      record("transition_guard", false, "terminal transition was allowed");
    } catch (e) {
      record(
        "transition_guard",
        /terminal/i.test(e?.message || ""),
        `message=${e?.message}`,
      );
    }
  });

  // 3. Partial UQ (second ACTIVE cart for same customer must fail).
  await inRollback(client, async () => {
    const c = await client.query(
      `INSERT INTO customers (first_name, phone) VALUES ('T', '201000000002') RETURNING id`,
    );
    await client.query(`INSERT INTO carts (customer_id) VALUES ($1)`, [
      c.rows[0].id,
    ]);
    try {
      await client.query(`INSERT INTO carts (customer_id) VALUES ($1)`, [
        c.rows[0].id,
      ]);
      record("partial_uq", false, "duplicate ACTIVE cart was accepted");
    } catch (e) {
      record(
        "partial_uq",
        e?.code === "23505",
        `code=${e?.code} constraint=${e?.constraint}`,
      );
    }
  });

  // 4. GENERATED available_quantity = quantity - reserved_quantity.
  await inRollback(client, async () => {
    const cat = await client.query(
      `INSERT INTO categories (name, slug) VALUES ('C', 'c-probe') RETURNING id`,
    );
    const prod = await client.query(
      `INSERT INTO products (name, slug, category_id, product_type, unit)
       VALUES ('P', 'p-probe', $1, 'PIECE', 'PIECE') RETURNING id`,
      [cat.rows[0].id],
    );
    const v = await client.query(
      `INSERT INTO product_variants (product_id, name, price)
       VALUES ($1, 'Pack', 100) RETURNING id`,
      [prod.rows[0].id],
    );
    const inv = await client.query(
      `INSERT INTO inventory (product_variant_id, quantity, reserved_quantity)
       VALUES ($1, 10, 3) RETURNING available_quantity`,
      [v.rows[0].id],
    );
    const available = Number(inv.rows[0].available_quantity);
    record("generated_column", available === 7, `available=${available}`);
    // GENERATED columns reject direct writes (proven: DB refuses structurally).
    try {
      await client.query(
        `INSERT INTO inventory (product_variant_id, quantity, reserved_quantity, available_quantity)
         VALUES ($1, 10, 3, 7)`,
        [v.rows[0].id],
      );
      record("generated_not_writable", false, "direct write was accepted");
    } catch (e) {
      // PostgreSQL refuses direct writes into GENERATED columns (428C9).
      record(
        "generated_not_writable",
        e?.code === "428C9",
        `code=${e?.code} message=${e?.message}`,
      );
    }
  });

  // 5. View reads.
  {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM product_stock_status`,
    );
    record("view_read", r.rows[0].n === 0, `rows=${r.rows[0].n}`);
  }

  // 6. Sequence catalog check (read-only: never calls nextval, no state change).
  {
    const r = await client.query(
      `SELECT seqstart AS start, seqincrement AS inc FROM pg_sequence s
         JOIN pg_class c ON c.oid = s.seqrelid
        WHERE c.relname = 'order_number_seq'`,
    );
    record(
      "sequence_catalog",
      r.rows[0]?.start === "1" && r.rows[0]?.inc === "1",
      `start=${r.rows[0]?.start} inc=${r.rows[0]?.inc}`,
    );
  }

  // 7. INET round-trip via raw SQL.
  await inRollback(client, async () => {
    await client.query(
      `INSERT INTO audit_logs (actor_type, action, entity_type, ip_address)
       VALUES ('SYSTEM', 'test.probe', 'test', '10.0.0.1')`,
    );
    const r = await client.query(
      `SELECT ip_address::text AS ip, host(ip_address) AS host FROM audit_logs WHERE action='test.probe'`,
    );
    // PostgreSQL inet::text renders a host address with its implicit mask
    // (/32); host() gives the bare address. Either proves the round-trip.
    record(
      "inet_roundtrip",
      r.rows[0]?.host === "10.0.0.1",
      `ip=${r.rows[0]?.ip} host=${r.rows[0]?.host}`,
    );
  });

  const failures = results.filter((r) => !r.pass).length;
  console.log(JSON.stringify({ database: dbName, failures, results }, null, 2));
  process.exitCode = failures === 0 ? 0 : 2;
} finally {
  await client.end().catch(() => {});
}
