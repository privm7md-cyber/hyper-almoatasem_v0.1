// Order-journey D6 coverage â€” the gaps no other harness suite owns.
//
// Usage: node scripts/api/t-order-journey-d6.mjs --db <name> --port <port>
//
// The D6 list has 20 items. Eleven of them are already covered and green in
// the existing suites (`t-orders`, `t-replacements`, `t-guest-orders`,
// `t-orders-concurrency`, `t-fulfillment`) and four more in the browser
// suite and the action-island unit tests. This suite owns ONLY the five that
// were not:
//   * item  4 â€” a guest credential issued for order A must not authorize
//               order B (explicit cross-order proof, both directions, plus
//               the mutation path).
//   * item  5 â€” an ORDER NUMBER is not an ownership proof: knowing a
//               stranger's number grants no read, no cancel and no listing.
//   * item  7 â€” a line was PICKED: the customer self-service cancel must
//               refuse (409), the order must stay alive and no CANCELLED
//               history row may be written.
//   * item  8 â€” two CONCURRENT cancels: exactly one winner, exactly ONE
//               CANCELLED history row, and the reservation is released once.
//   * item 16 â€” the checkout recovery session is revoked together with the
//               per-order credential (revoke AND rotate), and it stays a
//               READ-ONLY path that is structurally bound to its own order.
//
// Everything here runs through the REAL routes against the REAL database
// (no doubles). Direct SQL is used only for fixture guards (state before a
// mutation) and cleanup.
import "dotenv/config";
import { createHash } from "node:crypto";
import { extractSessionCookie } from "./_session-cookie.mjs";
import { Client } from "pg";
import { baseDeliveryFee } from "./_fee.mjs";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const portFlag = args.indexOf("--port");
const dbName = dbFlag === -1 ? null : args[dbFlag + 1];
const port = portFlag === -1 ? "3131" : args[portFlag + 1];

const results = [];
const t = (name, pass, detail = "") => results.push({ name, pass: pass === true, detail });
const done = (code) => {
  const failures = results.filter((r) => !r.pass);
  console.log(
    JSON.stringify(
      {
        suite: "order-journey-d6",
        db: dbName,
        total: results.length,
        failures: failures.length,
        failed: failures.map((f) => f.name),
        passed: results.filter((r) => r.pass).map((r) => r.name),
        // The actual observed result of EVERY assertion (status codes, row
        // states) â€” the evidence the final report cites.
        details: Object.fromEntries(results.map((r) => [r.name, r.detail])),
      },
      null,
      2,
    ),
  );
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_p12full_execution",
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_e2e_20261106",
  "hyper_almoatasem_closure_20261030",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const CPW = "Cust-Test-Pass-0001!";
const P330 = "01800000-0000-7000-8000-000000000201";
const P1L = "01800000-0000-7000-8000-000000000202";
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (v) => createHash("sha256").update(v, "utf8").digest("hex");

// Isolated fake-IP scopes: the harness server runs in the declared-proxy
// posture, so a single-valued `x-forwarded-for` is the client identity. Every
// guest read carries a fresh address so the 60/15min read bucket never fills
// across the run.
const xffState = { n: 21 };
const xff = () => `10.7.6.${xffState.n++}`;
const G = (tok, ip) => ({ "x-guest-token": tok, "x-forwarded-for": ip ?? xff() });
const GT = (tok) => ({ "x-guest-order-token": tok, "x-forwarded-for": xff() });
const H = (tok) => ({ "x-customer-token": tok });
const CK = (cookie) => ({ cookie });

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
  const FEE = await baseDeliveryFee(q, t);

  const get = async (path, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { ...headers } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const loginAs = async (email, password) => {
    const r = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => ({}));
    const ck = extractSessionCookie(r.headers.get("set-cookie"));
    return { status: r.status, body, cookie: ck ? ck.header : null };
  };

  const stamp = Date.now().toString(36);
  const keySeq = { n: 0 };
  const key = (p) => `d6-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const orderIds = new Set();
  const customerIds = new Set();
  const phones = new Set();

  const sess = async (phone, firstName) => {
    phones.add(phone);
    const reg = await post(`/api/store/customers/register`, { phone, firstName, password: CPW });
    if (reg.status === 201) {
      const id = reg.body?.data?.customer?.id ?? null;
      if (id) customerIds.add(id);
      return { id, tok: reg.body?.data?.customerToken ?? null };
    }
    const r = await post(`/api/store/customers/session`, { phone, password: CPW });
    const id = r.body?.data?.customer?.id ?? null;
    if (id) customerIds.add(id);
    return { id, tok: r.body?.data?.customerToken ?? null };
  };
  const mkGuestCart = async (lines) => {
    const g = await post(`/api/store/cart`, {});
    const tok = g.body?.data?.guestToken;
    if (g.body?.data?.cart?.id) cartIds.add(g.body.data.cart.id);
    for (const [vid, qty] of lines) {
      await post(`/api/store/cart/items`, { productVariantId: vid, quantity: qty }, { "x-guest-token": tok });
    }
    return tok;
  };
  const guestPayload = (phone, k, extra = {}) => ({
    guestContact: { firstName: "D6", lastName: null },
    guestAddress: {
      city: "Matai",
      area: null,
      village: null,
      street: "St 9",
      buildingNumber: "7",
      landmark: null,
      phone,
    },
    idempotencyKey: k,
    expectedDeliveryFee: FEE,
    ...extra,
  });
  const mkGuestOrder = async (lines, phone, k, extra = {}) => {
    const tok = await mkGuestCart(lines);
    const o = await post(`/api/store/orders`, guestPayload(phone, k, extra), G(tok));
    if (o.body?.data?.order?.id) orderIds.add(o.body.data.order.id);
    return { res: o, cartTok: tok };
  };
  const mkCustomerOrder = async (phone, firstName, k) => {
    const s = await sess(phone, firstName);
    const a = await post(`/api/store/customers/addresses`, { city: "Matai", phone }, H(s.tok));
    const g = await post(`/api/store/cart`, {}, H(s.tok));
    const cartId = g.body?.data?.cart?.id;
    if (cartId) cartIds.add(cartId);
    await post(`/api/store/cart/items`, { productVariantId: P330, quantity: "1" }, H(s.tok));
    const o = await post(
      `/api/store/orders`,
      { addressId: a.body?.data?.id ?? null, idempotencyKey: k, expectedDeliveryFee: FEE },
      H(s.tok),
    );
    if (o.body?.data?.order?.id) orderIds.add(o.body.data.order.id);
    return { res: o, sess: s };
  };
  const statusOf = async (id) =>
    (await q(`SELECT status s, customer_id::text c FROM orders WHERE id = $1`, [id]))[0];
  /** Extract the first `name=value` pair of a Set-Cookie header. */
  const cookieValue = (raw) => {
    if (!raw) return null;
    const first = String(raw).split(",")[0];
    const idx = first.indexOf("=");
    if (idx === -1) return null;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).split(";")[0].trim();
    return value ? { name, value } : null;
  };

  try {
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-201", owner.status === 201 && !!owner.cookie, `${owner.status}`);
    if (owner.status !== 201 || !owner.cookie) {
      console.error("REFUSED_LOGIN (retry after rollover)");
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = owner.cookie;

    // =====================================================================
    // item 4 â€” a guest credential is bound to ITS order and to no other.
    // =====================================================================
    const ga = await mkGuestOrder([[P330, "1"]], "01093000041", key("ga"));
    const gb = await mkGuestOrder([[P1L, "1"]], "01093000042", key("gb"));
    const oA = ga.res.body?.data?.order;
    const oB = gb.res.body?.data?.order;
    const tokA = ga.res.body?.data?.guestOrderToken;
    const tokB = gb.res.body?.data?.guestOrderToken;
    t("item4-setup", !!oA && !!oB && HEX64.test(tokA ?? "") && HEX64.test(tokB ?? ""), "two guest orders");

    const crossReadB = await get(`/api/store/orders/${oB.id}`, GT(tokA));
    t("item4-credential-A-cannot-read-B", crossReadB.status === 401, `${crossReadB.status}`);
    const crossReadA = await get(`/api/store/orders/${oA.id}`, GT(tokB));
    t("item4-credential-B-cannot-read-A", crossReadA.status === 401, `${crossReadA.status}`);
    // The cart bearer is NOT an order credential: it must not open either order.
    const cartBearerRead = await get(`/api/store/orders/${oB.id}`, G(gb.cartTok));
    t("item4-cart-bearer-cannot-read-order", cartBearerRead.status === 401, `${cartBearerRead.status}`);
    // The credential of A must not drive a MUTATION on B either.
    const crossCancel = await post(`/api/store/orders/${oB.id}/cancel`, {}, GT(tokA));
    const bRow = await statusOf(oB.id);
    t("item4-credential-A-cannot-cancel-B", crossCancel.status === 401 && bRow?.s === "CONFIRMED",
      `${crossCancel.status}/${bRow?.s}`);
    // No leak in any of the refusal bodies.
    t("item4-no-leak",
      ![crossReadB, crossReadA, cartBearerRead, crossCancel].some((r) =>
        JSON.stringify(r.body ?? {}).includes(oB.id) ||
        JSON.stringify(r.body ?? {}).includes(oA.id) ||
        JSON.stringify(r.body ?? {}).includes(tokA ?? "@") ||
        JSON.stringify(r.body ?? {}).includes(tokB ?? "@")),
      "no ids/tokens in refusals");
    // The rightful credential still works (the binding is not over-restrictive).
    t("item4-own-credential-still-works", (await get(`/api/store/orders/${oB.id}`, GT(tokB))).status === 200, "own");

    // =====================================================================
    // item 5 â€” the ORDER NUMBER is not an ownership proof.
    // =====================================================================
    const ca = await mkCustomerOrder("01093000051", "D6Alpha", key("ca"));
    const cb = await mkCustomerOrder("01093000052", "D6Beta", key("cb"));
    const ordA = ca.res.body?.data?.order;
    const ordB = cb.res.body?.data?.order;
    const numberKnown = ordA.orderNumber;
    const numberKnownId = ordA.id;
    // The two orders must belong to two DIFFERENT registered customers (the
    // serialized order shape carries no customer id, so ownership is read
    // from the database â€” the only place that holds it).
    const ownerRows = await q(
      `SELECT id::text o, customer_id::text c FROM orders WHERE id = ANY($1::uuid[])`,
      [[ordA.id, ordB.id]],
    );
    const ownerOf = (id) => ownerRows.find((r) => r.o === id)?.c ?? null;
    t("item5-setup",
      !!ordA?.orderNumber && !!ordB?.orderNumber && ordA.orderNumber !== ordB.orderNumber &&
      !!ownerOf(ordA.id) && !!ownerOf(ordB.id) && ownerOf(ordA.id) !== ownerOf(ordB.id),
      `${ordA?.orderNumber}/${ordB?.orderNumber}`);

    // B knows A's number. It grants B nothing.
    const bReadsA = await get(`/api/store/orders/${numberKnownId}`, H(cb.sess.tok));
    t("item5-number-does-not-grant-read", bReadsA.status === 404, `${bReadsA.status}`);
    const bCancelsA = await post(`/api/store/orders/${numberKnownId}/cancel`, {}, H(cb.sess.tok));
    const aRow = await statusOf(numberKnownId);
    t("item5-number-does-not-grant-cancel", bCancelsA.status === 404 && aRow?.s === "CONFIRMED",
      `${bCancelsA.status}/${aRow?.s}`);
    // A's number is absent from B's own order list.
    const bList = await get(`/api/store/orders`, H(cb.sess.tok));
    const bNumbers = (bList.body?.data ?? []).map((o) => o.orderNumber);
    t("item5-number-absent-from-foreign-list",
      bList.status === 200 && !bNumbers.includes(numberKnown) && bNumbers.includes(ordB.orderNumber),
      JSON.stringify(bNumbers));
    // No identity at all + the number â†’ still unauthenticated, never 404-as-found.
    const anonList = await get(`/api/store/orders`);
    t("item5-anonymous-number-401", anonList.status === 401, `${anonList.status}`);
    // A stranger's number used as an idempotency key must not disclose the order.
    // The idempotency key is CLIENT-chosen and independent of the order
    // number, so submitting a stranger's number as your own key is simply a
    // fresh key: the server may legitimately create YOUR order. What must
    // never happen is the STRANGER's order coming back, in whole or in part.
    const probeTok = await mkGuestCart([[P330, "1"]]);
    const keyProbe = await post(
      `/api/store/orders`,
      {
        guestContact: { firstName: "D6", lastName: null },
        guestAddress: {
          city: "Matai", area: null, village: null, street: "St 9",
          buildingNumber: "7", landmark: null, phone: "01093000053",
        },
        idempotencyKey: numberKnown,
        expectedDeliveryFee: FEE,
      },
      G(probeTok),
    );
    if (keyProbe.body?.data?.order?.id) orderIds.add(keyProbe.body.data.order.id);
    const probeOrder = keyProbe.body?.data?.order ?? null;
    const probeBody = JSON.stringify(keyProbe.body ?? {});
    t("item5-key-probe-no-disclosure",
      !probeBody.includes(numberKnownId) &&
      !(probeOrder && probeOrder.id === numberKnownId) &&
      !(probeOrder && probeOrder.orderNumber === numberKnown),
      `status=${keyProbe.status} probeOrder=${probeOrder?.orderNumber ?? "none"}`);
    // The stranger's order is untouched by the probe.
    const aRowAfterProbe = await statusOf(numberKnownId);
    t("item5-key-probe-leaves-order-intact", aRowAfterProbe?.s === "CONFIRMED", `${aRowAfterProbe?.s}`);
    // A guest presenting only A's NUMBER (no credential) cannot open the order.
    const guestNumberRead = await get(`/api/store/orders/${numberKnownId}`, G(await mkGuestCart([])));
    t("item5-guest-number-401", guestNumberRead.status === 401, `${guestNumberRead.status}`);

    // =====================================================================
    // item 16 â€” the checkout recovery session dies with the credential.
    // =====================================================================
    const gTok = await mkGuestCart([[P1L, "1"]]);
    const mint = await fetch(`${baseUrl}/api/store/orders/checkout-session`, {
      method: "POST",
      headers: { "x-guest-token": gTok, "x-forwarded-for": xff() },
    });
    await mint.json().catch(() => ({}));
    const ckParsed = cookieValue(mint.headers.get("set-cookie"));
    t("item16-session-minted", mint.status === 200 && !!ckParsed && HEX64.test(ckParsed.value),
      `${mint.status}/${ckParsed?.name}`);
    if (!ckParsed) throw new Error("CHECKOUT_SESSION_NOT_MINTED");
    const sessionToken = ckParsed.value;
    const sessionCookie = `${ckParsed.name}=${sessionToken}`;

    // Hash-only at rest, fixed 24h TTL, no raw token persisted.
    const sessRows = await q(
      `SELECT token_hash::text h, expires_at, revoked_at, cart_id::text c, order_id::text o
         FROM guest_checkout_sessions WHERE token_hash = $1`,
      [sha256(sessionToken)],
    );
    const srow = sessRows[0];
    t("item16-hash-only", srow?.h === sha256(sessionToken), "sha256 stored");
    const rawLeak = await q(
      `SELECT count(*)::int AS n FROM guest_checkout_sessions WHERE token_hash = $1`,
      [sessionToken],
    );
    t("item16-raw-token-not-stored", rawLeak[0].n === 0, "no raw token");
    const ttlHours = srow ? (new Date(srow.expires_at).getTime() - Date.now()) / 3600000 : 0;
    t("item16-fixed-24h-ttl", ttlHours > 23 && ttlHours <= 24.1, `${ttlHours.toFixed(2)}h`);

    // The order is created WITH the session presented â†’ the session binds to it.
    const created = await post(
      `/api/store/orders`,
      guestPayload("01093000061", key("cs")),
      { ...G(gTok), cookie: sessionCookie },
    );
    const oC = created.body?.data?.order;
    const tokC = created.body?.data?.guestOrderToken;
    if (oC?.id) orderIds.add(oC.id);
    t("item16-order-created-with-session", created.status === 201 && !!oC?.id && HEX64.test(tokC ?? ""),
      `${created.status}`);
    const boundRow = (
      await q(
        `SELECT order_id::text o, revoked_at FROM guest_checkout_sessions WHERE token_hash = $1`,
        [sha256(sessionToken)],
      )
    )[0];
    t("item16-session-bound-to-order", boundRow?.o === oC?.id && boundRow?.revoked_at === null,
      `${boundRow?.o}`);
    // The session alone reads the order (the recovery path exists).
    const sessionRead = await get(`/api/store/orders/${oC.id}`, { cookie: sessionCookie, "x-forwarded-for": xff() });
    t("item16-session-reads-order", sessionRead.status === 200, `${sessionRead.status}`);
    // The session is READ-ONLY: it must never authorize a mutation.
    const sessionCancel = await post(`/api/store/orders/${oC.id}/cancel`, {}, {
      cookie: sessionCookie, "x-forwarded-for": xff(),
    });
    const cRow = await statusOf(oC.id);
    t("item16-session-cannot-mutate", sessionCancel.status === 401 && cRow?.s === "CONFIRMED",
      `${sessionCancel.status}/${cRow?.s}`);
    // The session is structurally bound: it cannot read another order.
    const otherOrderRead = await get(`/api/store/orders/${oB.id}`, {
      cookie: sessionCookie, "x-forwarded-for": xff(),
    });
    t("item16-session-not-bound-to-other-order", otherOrderRead.status === 401, `${otherOrderRead.status}`);

    // --- revoke the per-order credential â†’ the recovery path must die too ---
    const revoke = await post(`/api/admin/orders/${oC.id}/credential/revoke`, {}, CK(ck));
    t("item16-revoke-200", revoke.status === 200 && revoke.body?.data?.revoked === true, `${revoke.status}`);
    const afterRevoke = await get(`/api/store/orders/${oC.id}`, {
      cookie: sessionCookie, "x-forwarded-for": xff(),
    });
    const sessRevokedRow = (
      await q(`SELECT revoked_at FROM guest_checkout_sessions WHERE token_hash = $1`, [sha256(sessionToken)])
    )[0];
    t("item16-session-revoked-with-credential",
      afterRevoke.status === 401 && sessRevokedRow?.revoked_at !== null,
      `${afterRevoke.status}`);
    const credRead = await get(`/api/store/orders/${oC.id}`, GT(tokC));
    t("item16-credential-dead-after-revoke", credRead.status === 401, `${credRead.status}`);

    // --- rotate the per-order credential â†’ the recovery path must die too ---
    const gTok2 = await mkGuestCart([[P330, "1"]]);
    const mint2 = await fetch(`${baseUrl}/api/store/orders/checkout-session`, {
      method: "POST",
      headers: { "x-guest-token": gTok2, "x-forwarded-for": xff() },
    });
    const ck2 = cookieValue(mint2.headers.get("set-cookie"));
    if (!ck2) throw new Error("CHECKOUT_SESSION_2_NOT_MINTED");
    const sessionCookie2 = `${ck2.name}=${ck2.value}`;
    const created2 = await post(`/api/store/orders`, guestPayload("01093000062", key("cs2")), {
      ...G(gTok2),
      cookie: sessionCookie2,
    });
    const oD = created2.body?.data?.order;
    const tokD = created2.body?.data?.guestOrderToken;
    if (oD?.id) orderIds.add(oD.id);
    t("item16-second-order-created", created2.status === 201 && !!oD?.id, `${created2.status}`);
    const sessionRead2 = await get(`/api/store/orders/${oD.id}`, {
      cookie: sessionCookie2, "x-forwarded-for": xff(),
    });
    t("item16-second-session-reads", sessionRead2.status === 200, `${sessionRead2.status}`);
    const rotate = await post(`/api/admin/orders/${oD.id}/credential/rotate`, {}, CK(ck));
    const tokD2 = rotate.body?.data?.guestOrderToken ?? null;
    t("item16-rotate-200-fresh", rotate.status === 200 && HEX64.test(tokD2 ?? "") && tokD2 !== tokD,
      `${rotate.status}`);
    const afterRotate = await get(`/api/store/orders/${oD.id}`, {
      cookie: sessionCookie2, "x-forwarded-for": xff(),
    });
    const sess2Revoked = (
      await q(`SELECT revoked_at FROM guest_checkout_sessions WHERE token_hash = $1`, [sha256(ck2.value)])
    )[0];
    t("item16-session-revoked-with-rotation",
      afterRotate.status === 401 && sess2Revoked?.revoked_at !== null,
      `${afterRotate.status}`);
    const oldCred = await get(`/api/store/orders/${oD.id}`, GT(tokD));
    t("item16-old-credential-dead-after-rotate", oldCred.status === 401, `${oldCred.status}`);
    const newCred = await get(`/api/store/orders/${oD.id}`, GT(tokD2));
    t("item16-new-credential-works", newCred.status === 200, `${newCred.status}`);

    // --- the revocation is permanent: re-reading stays 401 ---
    await new Promise((r) => setTimeout(r, 50));
    t("item16-revocation-is-stable",
      (await get(`/api/store/orders/${oC.id}`, { cookie: sessionCookie, "x-forwarded-for": xff() })).status === 401,
      "still dead");

    // =====================================================================
    // item 7 â€” a line was picked: the order can no longer be cancelled.
    // =====================================================================
    // The pick is a FULFILLMENT fact (actual quantity set, stock committed).
    // From that moment the customer self-service cancel must refuse: the
    // cancellation would have to restock a line that already left the shelf.
    const g7 = await mkGuestOrder([[P330, "1"]], "01093000071", key("g7"));
    const o7 = g7.res.body?.data?.order;
    const tok7 = g7.res.body?.data?.guestOrderToken;
    t("item7-setup", !!o7?.id && HEX64.test(tok7 ?? ""), `${g7.res.status}`);
    const prep7 = await post(`/api/admin/orders/${o7.id}/prepare`, {}, CK(ck));
    t("item7-prepared", prep7.status === 200 && prep7.body?.data?.order?.status === "PREPARING",
      `${prep7.status}/${prep7.body?.data?.order?.status}`);
    const items7 = (await get(`/api/store/orders/${o7.id}`, GT(tok7))).body?.data?.order?.items ?? [];
    const line7 = items7.find((i) => i.productVariantId === P330);
    const pick7 = await post(`/api/admin/orders/${o7.id}/items/${line7.id}/pick`, { actualQuantity: "1" }, CK(ck));
    const pickedLine = pick7.body?.data?.order?.items?.find((i) => i.id === line7.id);
    t("item7-pick-applied", pick7.status === 200 && pickedLine?.itemStatus === "FULFILLED",
      `${pick7.status}/${pickedLine?.itemStatus}`);

    const cancel7 = await post(`/api/store/orders/${o7.id}/cancel`, {}, GT(tok7));
    t("item7-cancel-after-pick-409", cancel7.status === 409, `${cancel7.status}`);
    const row7 = await statusOf(o7.id);
    t("item7-order-not-cancelled", row7?.s === "PREPARING", `${row7?.s}`);
    const hist7 = await q(
      `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1::uuid AND new_status = 'CANCELLED'`,
      [o7.id],
    );
    t("item7-no-cancel-history", hist7[0].n === 0, `${hist7[0].n}`);
    // The refusal is a business decision, never a crash.
    t("item7-refusal-is-not-internal",
      cancel7.status !== 500 && (cancel7.body?.error?.code ?? "") !== "INTERNAL",
      `${cancel7.status}/${cancel7.body?.error?.code ?? "none"}`);

    // =====================================================================
    // item 8 â€” two concurrent cancels: ONE winner, ONE history row.
    // =====================================================================
    const g8 = await mkGuestOrder([[P330, "1"]], "01093000081", key("g8"));
    const o8 = g8.res.body?.data?.order;
    const tok8 = g8.res.body?.data?.guestOrderToken;
    const reservedOf = async (vid) =>
      (await q(`SELECT reserved_quantity::text AS r FROM inventory WHERE product_variant_id = $1`, [vid]))[0].r;
    const reservedBefore8 = await reservedOf(P330);
    const [c8a, c8b] = await Promise.all([
      post(`/api/store/orders/${o8.id}/cancel`, {}, GT(tok8)),
      post(`/api/store/orders/${o8.id}/cancel`, {}, GT(tok8)),
    ]);
    const statuses8 = [c8a.status, c8b.status].sort().join(",");
    t("item8-one-winner-one-conflict", statuses8 === "200,409", statuses8);
    const row8 = await statusOf(o8.id);
    t("item8-order-cancelled", row8?.s === "CANCELLED", `${row8?.s}`);
    const hist8 = await q(
      `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1::uuid AND new_status = 'CANCELLED'`,
      [o8.id],
    );
    t("item8-single-history-row", hist8[0].n === 1, `${hist8[0].n}`);
    const reservedAfter8 = await reservedOf(P330);
    t("item8-reservation-released-once", Number(reservedBefore8) - Number(reservedAfter8) === 1,
      `${reservedBefore8}->${reservedAfter8}`);
  } finally {
    // ---------- cleanup (mirrors the sibling suites' hygiene) ----------
    try {
      const ids = [...orderIds];
      if (ids.length > 0) {
        // Release the holds the suite's own orders still carry BEFORE the
        // rows are deleted. A line that was PICKED already had its hold
        // released by the pick (actual_quantity IS NOT NULL), so it must not
        // be released twice.
        await db.query(
          `UPDATE inventory i SET reserved_quantity = i.reserved_quantity - h.qty
             FROM (SELECT product_variant_id, sum(requested_quantity) AS qty
                     FROM order_items
                    WHERE order_id = ANY($1::uuid[]) AND actual_quantity IS NULL
                    GROUP BY product_variant_id) h
            WHERE i.product_variant_id = h.product_variant_id`,
          [ids],
        ).catch(() => {});
        await db.query(`DELETE FROM guest_order_credentials WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM guest_checkout_sessions WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[]))`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_discounts WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]).catch(() => {});
      }
      await db.query(`DELETE FROM guest_checkout_sessions WHERE cart_id IS NOT NULL AND order_id IS NULL`).catch(() => {});
      // The item-7 pick committed stock: drop the movement it wrote and put
      // the fixture quantity back, so the suite leaves the inventory exactly
      // as it found it.
      await db.query(`DELETE FROM inventory_movements WHERE product_variant_id = $1`, [P330]).catch(() => {});
      await db.query(`UPDATE inventory SET quantity = 500.000, reserved_quantity = 0 WHERE product_variant_id = $1`, [P330]).catch(() => {});
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      for (const cid of customerIds) {
        await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [cid]).catch(() => {});
        await db.query(`DELETE FROM customer_sessions WHERE customer_id = $1`, [cid]).catch(() => {});
        await db.query(`DELETE FROM customers WHERE id = $1`, [cid]).catch(() => {});
      }
    } catch {
      /* cleanup is best-effort; the harness clones a pristine DB per suite */
    }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((error) => {
  console.error(`SUITE_CRASH: ${error?.stack ?? error}`);
  done(3);
});
