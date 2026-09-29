// BA-5 cart API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-cart.mjs --db <name> --port <port>
// Covers: guest/customer cart create+resolve, add (aggregate, snapshots,
// counting units, step/pack gates), set-qty, remove, clear, merge
// (reassign/sum/drop + report), subtotal math, ownership isolation, and
// error envelopes. Uses frozen catalog fixtures (Romi/P330/P1L) read-only
// plus BA-4 identify for customer carts; all carts/customers created here
// are removed in cleanup. Draft only — asserts inventory untouched.
// Prints JSON, never tokens beyond test flow (no secrets).
import "dotenv/config";
import { Client } from "pg";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ suite: "cart", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_seed_20260923",
  "hyper_almoatasem_auth_20260923",
  "hyper_almoatasem_authb_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const ROMI_V = "01800000-0000-7000-8000-000000000101";
const P330 = "01800000-0000-7000-8000-000000000201";
const P1L = "01800000-0000-7000-8000-000000000202";
const UNKNOWN = "04800000-0000-7000-8000-000000009999";
const P_C1 = "01091000011";
const P_C2 = "01091000022";
const CANON = (p) => "2010" + p.slice(3);
const HEX64 = /^[0-9a-f]{64}$/i;

async function main() {
  if (!dbName || !ALLOWED.includes(dbName)) {
    console.error(`REFUSED_DB: ${dbName}`);
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const probe = await fetch(`${baseUrl}/api/admin/session`, { method: "GET" });
    await probe.text();
  } catch {
    console.error(`REFUSED_NO_SERVER: nothing listening at ${baseUrl}`);
    process.exit(1);
  }
  const scratchUrl = (() => {
    const u = new URL(process.env.MIGRATION_DATABASE_URL);
    u.pathname = `/${dbName}`;
    return u.toString();
  })();
  const db = new Client({ connectionString: scratchUrl, connectionTimeoutMillis: 5000 });
  await db.connect();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;

  const get = async (path, token = null, customerId = null) => {
    const qs = customerId ? `?customerId=${customerId}` : "";
    const r = await fetch(`${baseUrl}${path}${qs}`, { headers: token ? { "x-guest-token": token } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, token = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(token ? { "x-guest-token": token } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const del = async (path, token = null, customerId = null) => {
    const qs = customerId ? `?customerId=${customerId}` : "";
    const r = await fetch(`${baseUrl}${path}${qs}`, {
      method: "DELETE",
      headers: token ? { "x-guest-token": token } : {},
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const cartIds = new Set();
  const track = (body) => {
    const id = body?.data?.cart?.id;
    if (id) cartIds.add(id);
  };
  const num = (s) => Number(s);
  const lineOf = (cart, vid) => cart.lines.find((l) => l.productVariantId === vid);

  try {
    // ---------- fixture guard ----------
    const px = await q(`SELECT id, price::text p FROM product_variants WHERE id IN ($1,$2)`, [P330, ROMI_V]);
    const pmap = Object.fromEntries(px.map((r) => [r.id, r.p]));
    t("fixture-prices", pmap[P330] === "15.00" && pmap[ROMI_V] === "320.00", JSON.stringify(pmap));

    // ---------- customers via BA-4 identify ----------
    const c1 = await post(`/api/store/customers/identify`, { phone: P_C1, firstName: "Cart1" });
    const c2 = await post(`/api/store/customers/identify`, { phone: P_C2, firstName: "Cart2" });
    const idC1 = c1.body.data.id;
    const idC2 = c2.body.data.id;
    t("customers-ready", c1.status <= 201 && c2.status <= 201 && !!idC1 && !!idC2);

    // ---------- guest create / resolve ----------
    const g1 = await post(`/api/store/cart`, {});
    track(g1.body);
    const tok1 = g1.body?.data?.guestToken;
    t("guest-create-201", g1.status === 201 && !!tok1 && HEX64.test(tok1)
      && g1.body.data.cart.guest === true && g1.body.data.cart.lines.length === 0
      && g1.body.data.cart.expiresAt !== null && g1.body.data.cart.status === "ACTIVE");
    const g1b = await post(`/api/store/cart`, {}, tok1);
    track(g1b.body);
    t("guest-resolve-200-once", g1b.status === 200 && g1b.body.data.cart.id === g1.body.data.cart.id
      && g1b.body.data.guestToken === undefined);
    const gUnknown = await get(`/api/store/cart`, "f".repeat(64));
    t("guest-unknown-token-404", gUnknown.status === 404);
    const gMal = await get(`/api/store/cart`, "abc");
    t("guest-malformed-token-400", gMal.status === 400);
    const gNeither = await post(`/api/store/cart`, {});
    t("guest-create-second-201", gNeither.status === 201 && gNeither.body.data.cart.id !== g1.body.data.cart.id);
    track(gNeither.body);
    const tok2 = gNeither.body.data.guestToken;
    const bothSides = await post(`/api/store/cart`, { customerId: idC1 }, tok1);
    t("owner-both-400", bothSides.status === 400);

    // ---------- customer create ----------
    const cc1 = await post(`/api/store/cart`, { customerId: idC1 });
    track(cc1.body);
    t("customer-create-201", cc1.status === 201 && cc1.body.data.cart.guest === false
      && cc1.body.data.cart.customerId === idC1 && cc1.body.data.cart.expiresAt === null);
    const cc1b = await post(`/api/store/cart`, { customerId: idC1 });
    t("customer-resolve-200", cc1b.status === 200 && cc1b.body.data.cart.id === cc1.body.data.cart.id);
    const cMiss = await post(`/api/store/cart`, { customerId: UNKNOWN });
    t("customer-unknown-404", cMiss.status === 404);
    const cMal = await post(`/api/store/cart`, { customerId: "nope" });
    t("customer-malformed-400", cMal.status === 400);

    // ---------- add items (guest cart) ----------
    const a1 = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "2" }, tok1);
    track(a1.body);
    const l1 = lineOf(a1.body.data.cart, P330);
    t("add-piece-200", a1.status === 200 && l1 && num(l1.quantity) === 2 && l1.unitSnapshot === "PIECE"
      && num(l1.unitPriceSnapshot) === 15 && l1.lineTotal === "30.00" && a1.body.data.cart.subtotal === "30.00");
    const a2 = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1" }, tok1);
    t("add-reaggregate-200", a2.status === 200 && num(lineOf(a2.body.data.cart, P330).quantity) === 3
      && a2.body.data.cart.lines.length === 1);
    const a3 = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.500" }, tok1);
    const lw = lineOf(a3.body.data.cart, ROMI_V);
    t("add-weight-200", a3.status === 200 && lw && lw.unitSnapshot === "KG" && num(lw.unitPriceSnapshot) === 320
      && lw.lineTotal === "160.00" && a3.body.data.cart.subtotal === "205.00");
    const aMiss = await post(`/api/store/cart/items`, { productVariantId: UNKNOWN, quantity: "1" }, tok1);
    t("add-unknown-variant-404", aMiss.status === 404);
    const aMal = await post(`/api/store/cart/items`, { productVariantId: "nope", quantity: "1" }, tok1);
    t("add-malformed-variant-400", aMal.status === 400);
    for (const [nm, qty, code] of [["zero", "0", 400], ["negative", "-1", 400], ["precision", "0.1234", 400]]) {
      const r = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: qty }, tok1);
      t(`add-${nm}-400`, r.status === code);
    }
    const aNum = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: 2 }, tok1);
    t("add-no-coerce-400", aNum.status === 400);
    const aFrac = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "0.500" }, tok1);
    t("add-piece-fraction-422", aFrac.status === 422);
    const aStep = await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.100" }, tok1);
    t("add-step-violation-422", aStep.status === 422);
    await db.query(`UPDATE product_variants SET is_active = FALSE WHERE id = $1`, [P1L]);
    const aOff = await post(`/api/store/cart/items`, { productVariantId: P1L, quantity: "1" }, tok1);
    t("add-inactive-variant-422", aOff.status === 422);
    await db.query(`UPDATE product_variants SET is_active = TRUE WHERE id = $1`, [P1L]);
    const aNoCart = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1" }, "e".repeat(64));
    t("add-no-cart-404", aNoCart.status === 404);
    const aExtra = await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1", price: "5.00" }, tok1);
    t("add-unknown-field-400", aExtra.status === 400);
    const invAfter = await q(`SELECT reserved_quantity::text r FROM inventory WHERE product_variant_id = $1`, [ROMI_V]);
    t("add-no-inventory-touch", invAfter[0].r === "0.000");

    // ---------- set quantity ----------
    const s1 = await patch(`/api/store/cart/items/${P330}`, { quantity: "5" }, tok1);
    t("set-qty-200", s1.status === 200 && num(lineOf(s1.body.data.cart, P330).quantity) === 5
      && s1.body.data.cart.subtotal === "235.00");
    const s2 = await patch(`/api/store/cart/items/${ROMI_V}`, { quantity: "0.250" }, tok1);
    t("set-weight-200", s2.status === 200 && s2.body.data.cart.subtotal === "155.00");
    const sZero = await patch(`/api/store/cart/items/${P330}`, { quantity: "0" }, tok1);
    t("set-zero-400", sZero.status === 400);
    const sMiss = await patch(`/api/store/cart/items/${P1L}`, { quantity: "1" }, tok1);
    t("set-missing-line-404", sMiss.status === 404);
    const sStep = await patch(`/api/store/cart/items/${ROMI_V}`, { quantity: "0.100" }, tok1);
    t("set-step-violation-422", sStep.status === 422);

    // ---------- remove / clear ----------
    const r1 = await del(`/api/store/cart/items/${ROMI_V}`, tok1);
    t("remove-200", r1.status === 200 && !lineOf(r1.body.data.cart, ROMI_V) && r1.body.data.cart.subtotal === "75.00");
    const rMiss = await del(`/api/store/cart/items/${ROMI_V}`, tok1);
    t("remove-missing-404", rMiss.status === 404);
    const cl1 = await del(`/api/store/cart/items`, tok1);
    t("clear-200", cl1.status === 200 && cl1.body.data.cart.lines.length === 0 && cl1.body.data.cart.subtotal === "0.00");
    const cl2 = await del(`/api/store/cart/items`, tok1);
    t("clear-empty-200", cl2.status === 200);

    // ---------- merge: reassign path ----------
    const g2 = await post(`/api/store/cart`, {});
    track(g2.body);
    const tokR = g2.body.data.guestToken;
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "2" }, tokR);
    const m1 = await post(`/api/store/cart/merge`, { customerId: idC2 }, tokR);
    track(m1.body);
    t("merge-reassign-200", m1.status === 200 && m1.body.data.merge.mode === "reassigned"
      && m1.body.data.cart.customerId === idC2 && m1.body.data.cart.status === "ACTIVE"
      && m1.body.data.cart.lines.length === 1);
    const staleTok = await get(`/api/store/cart`, tokR);
    t("merge-token-retired-404", staleTok.status === 404);

    // ---------- merge: sum path ----------
    await post(`/api/store/cart/items`, { customerId: idC1, productVariantId: P330, quantity: "1" });
    const g3 = await post(`/api/store/cart`, {});
    track(g3.body);
    const tokS = g3.body.data.guestToken;
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "2" }, tokS);
    await post(`/api/store/cart/items`, { productVariantId: ROMI_V, quantity: "0.250" }, tokS);
    const m2 = await post(`/api/store/cart/merge`, { customerId: idC1 }, tokS);
    track(m2.body);
    const mc = m2.body.data.cart;
    t("merge-sum-200", m2.status === 200 && m2.body.data.merge.mode === "merged"
      && num(lineOf(mc, P330).quantity) === 3 && num(lineOf(mc, ROMI_V).quantity) === 0.25
      && m2.body.data.merge.summed === 1 && m2.body.data.merge.inserted === 1);
    t("merge-repriced-live", num(lineOf(mc, P330).unitPriceSnapshot) === 15 && lineOf(mc, P330).priceCheckedAt !== null);
    const m2dbl = await post(`/api/store/cart/merge`, { customerId: idC1 }, tokS);
    t("merge-double-409", m2dbl.status === 409);

    // ---------- merge: dead-line drop ----------
    const g4 = await post(`/api/store/cart`, {});
    track(g4.body);
    const tokD = g4.body.data.guestToken;
    await post(`/api/store/cart/items`, { productVariantId: P1L, quantity: "1" }, tokD);
    await db.query(`UPDATE product_variants SET is_active = FALSE WHERE id = $1`, [P1L]);
    const m3 = await post(`/api/store/cart/merge`, { customerId: idC1 }, tokD);
    t("merge-drop-dead", m3.status === 200 && m3.body.data.merge.dropped.length === 1
      && m3.body.data.merge.dropped[0].variantId === P1L
      && !lineOf(m3.body.data.cart, P1L));
    await db.query(`UPDATE product_variants SET is_active = TRUE WHERE id = $1`, [P1L]);
    const mMiss = await post(`/api/store/cart/merge`, { customerId: idC1 }, "d".repeat(64));
    t("merge-unknown-token-404", mMiss.status === 404);
    const mMalT = await post(`/api/store/cart/merge`, { customerId: idC1 }, "bad");
    t("merge-malformed-token-400", mMalT.status === 400);
    const mMalC = await post(`/api/store/cart/merge`, { customerId: "nope" }, tokD);
    t("merge-malformed-customer-400", mMalC.status === 400);
    const mNoCust = await post(`/api/store/cart/merge`, { customerId: UNKNOWN }, tok2);
    t("merge-unknown-customer-404", mNoCust.status === 404);

    // ---------- merge into inactive customer ----------
    await db.query(`UPDATE customers SET is_active = FALSE WHERE phone = $1`, [CANON(P_C2)]);
    const g5 = await post(`/api/store/cart`, {});
    track(g5.body);
    const mInact = await post(`/api/store/cart/merge`, { customerId: idC2 }, g5.body.data.guestToken);
    t("merge-inactive-customer-422", mInact.status === 422);
    await db.query(`UPDATE customers SET is_active = TRUE WHERE phone = $1`, [CANON(P_C2)]);

    // ---------- ownership isolation ----------
    const isoB = await get(`/api/store/cart`, tok2);
    t("guest-isolation-404", isoB.status === 404 || isoB.body?.data?.cart?.id !== g1.body.data.cart.id);
    const noOwner = await get(`/api/store/cart`);
    t("get-no-owner-400", noOwner.status === 400);

    // ---------- read-back ----------
    const rb = await get(`/api/store/cart`, null, idC1);
    t("read-customer-cart-200", rb.status === 200 && rb.body.data.cart.customerId === idC1
      && rb.body.data.cart.lines.length >= 2);
  } finally {
    // Hygiene: remove BA-5 carts/items + customers + sessions.
    try {
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
          await db.query(`DELETE FROM carts WHERE customer_id = $1`, [r.id]).catch(() => {});
        }
      }
      for (const ph of [P_C1, P_C2].map(CANON)) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`CART_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
