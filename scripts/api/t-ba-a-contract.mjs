// BA-A API contract suite (real PostgreSQL scratch + static checks).
// Usage: node scripts/api/t-ba-a-contract.mjs --db <name> --port <port>
// Covers the BA-A foundation gate: canonical envelopes (success/error/201/
// safe-500), strict validation, pagination, decimal strings, ISO instants,
// Idempotency-Key header contract (6-case matrix), SQL time boundaries,
// phone ladder (+ concurrent identity), guest-token lifecycle (incl.
// expired-token rejection), and bidirectional openapi.yaml ⇄ routes
// coverage. Prints JSON, never secrets.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  console.log(JSON.stringify({ suite: "ba-a-contract", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
  process.exitCode = code ?? (failures.length === 0 ? 0 : 2);
};

const ALLOWED = [
  "hyper_almoatasem_scratch",
  "hyper_almoatasem_scratch_official_20260923",
  "hyper_almoatasem_hardening_20260924",
  "hyper_almoatasem_staging_20260924",
];

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const P330 = "01800000-0000-7000-8000-000000000201";
const P_BAC = "01096000131";
const CANON = (p) => "2010" + p.slice(3);
const ROOT = process.cwd();

async function main() {
  // ---------- static S1: openapi ⇄ routes bidirectional coverage ----------
  try {
    const yaml = fs.readFileSync(path.join(ROOT, "docs/openapi.yaml"), "utf8");
    const docPaths = new Set([...yaml.matchAll(/^  (\/api\/[^:\s]+):/gm)].map((m) => m[1]));
    const routeFiles = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") routeFiles.push(p);
      }
    };
    walk(path.join(ROOT, "src/app/api"));
    const implPaths = new Set(routeFiles.map((f) => {
      let rel = path.relative(path.join(ROOT, "src/app/api"), path.dirname(f)).replace(/\\/g, "/");
      rel = "/api/" + rel;
      rel = rel.replace(/\[id\]/g, "{id}").replace(/\[variantId\]/g, "{variantId}")
        .replace(/\[addressId\]/g, "{addressId}").replace(/\[itemId\]/g, "{itemId}")
        .replace(/\[roleId\]/g, "{roleId}").replace(/\[permissionId\]/g, "{permissionId}")
        .replace(/\[targetId\]/g, "{targetId}").replace(/\[replacementId\]/g, "{replacementId}")
        .replace(/\[key\]/g, "{key}");
      return rel;
    }));
    const missingInDoc = [...implPaths].filter((p) => !docPaths.has(p));
    const missingInImpl = [...docPaths].filter((p) => !implPaths.has(p));
    t("s1-openapi-covers-routes", missingInDoc.length === 0, missingInDoc.slice(0, 5).join(","));
    t("s1-routes-cover-openapi", missingInImpl.length === 0, missingInImpl.slice(0, 5).join(","));
    const adminOps = [...yaml.matchAll(/^  \/api\/admin\/[^:\s]+:\n((?:    (?:get|post|patch|put|delete):[^\n]*\n(?:.*\n)*?)*)/gm)];
    t("s1-doc-present", docPaths.size >= 70, String(docPaths.size));
  } catch (e) {
    t("s1-openapi-covers-routes", false, String(e.message).slice(0, 120));
    t("s1-routes-cover-openapi", false, "read failed");
    t("s1-doc-present", false, "read failed");
  }

  // ---------- static S2: no JS-clock gates on decoded DB timestamps ----------
  try {
    const gateFiles = [
      "src/lib/auth/login.ts",
      "src/lib/auth/session.ts",
      "src/lib/auth/rbac.ts",
      "src/lib/promotions/queries.ts",
      "src/lib/orders/writes.ts",
      "src/lib/cart/writes.ts",
      "src/lib/cart/queries.ts",
    ];
    const bad = [];
    for (const f of gateFiles) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      const lines = src.split("\n");
      lines.forEach((ln, i) => {
        if (/new Date\((row|current|cp|order|c|locked|user)\b/.test(ln)) bad.push(`${f}:${i + 1}`);
        if (/\.getTime\(\)/.test(ln) && !/nowMs/.test(ln)) bad.push(`${f}:${i + 1}`);
      });
    }
    t("s2-no-js-clock-gates", bad.length === 0, bad.slice(0, 5).join(","));
  } catch (e) {
    t("s2-no-js-clock-gates", false, String(e.message).slice(0, 120));
  }

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

  const get = async (path, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, cookie = null, headers = {}) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(data),
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
    const m = (r.headers.get("set-cookie") || "").match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, body, cookie: m ? `__Host-admin-session=${m[1]}` : null };
  };

  const stamp = Date.now().toString(36);
  const keySeq = { n: 0 };
  const key = (p) => `baac-${p}-${stamp}-${keySeq.n++}`;
  const cartIds = new Set();
  const promoIds = new Set();
  const couponIds = new Set();
  const brandIds = new Set();
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash")
    && !JSON.stringify(o).includes("__Host-admin-session");
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));

  try {
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("logins-ok", store.status === 201 && owner.status === 201, `${store.status}/${owner.status}`);
    if (store.status !== 201 || owner.status !== 201 || !store.cookie || !owner.cookie) {
      console.error(`REFUSED_LOGIN: store=${store.status} owner=${owner.status} (retry after rollover)`);
      await db.end().catch(() => {});
      process.exit(1);
    }
    const ck = store.cookie;
    const cko = owner.cookie;
    t("login-envelope-201", owner.body.data?.admin?.email === OWNER_EMAIL && owner.body.meta !== undefined);
    const badLogin = await loginAs(STORE_EMAIL, "Wrong-Pass-000!");
    t("login-error-envelope", badLogin.status === 401 && badLogin.body.error?.code === "UNAUTHENTICATED" && noSecrets(badLogin.body));

    // ---------- E: envelopes / validation / pagination / decimals / ISO ----------
    const bList = await get(`/api/admin/catalog/brands?limit=5`, ck);
    t("e-success-envelope", bList.status === 200 && Array.isArray(bList.body.data) && typeof bList.body.meta === "object");
    const bName = `BAAC Brand ${stamp}`;
    const bCreate = await post(`/api/admin/catalog/brands`, { name: bName }, ck);
    t("e-201-envelope", bCreate.status === 201 && typeof bCreate.body.data?.id === "string" && typeof bCreate.body.meta === "object",
      String(bCreate.status));
    brandIds.add(bCreate.body.data.id);
    const badUuid = await get(`/api/admin/catalog/brands/not-a-uuid`, ck);
    t("e-400-envelope", badUuid.status === 400 && badUuid.body.error?.code === "VALIDATION" && noSecrets(badUuid.body));
    const missUuid = await get(`/api/admin/catalog/brands/04800000-0000-7000-8000-000000009999`, ck);
    t("e-404-envelope", missUuid.status === 404 && missUuid.body.error?.code === "NOT_FOUND");
    const extra = await post(`/api/admin/catalog/brands`, { name: `BAAC X ${stamp}`, bogusField: 1 }, ck);
    t("e-strict-400", extra.status === 400 && extra.body.error?.code === "VALIDATION", String(extra.status));
    const bigPage = await get(`/api/admin/catalog/brands?limit=500`, ck);
    t("e-page-bound-400", bigPage.status === 400 && bigPage.body.error?.code === "VALIDATION");
    const smallPage = await get(`/api/admin/catalog/brands?limit=2`, ck);
    t("e-page-meta", smallPage.status === 200 && smallPage.body.meta?.limit === 2 && "nextCursor" in smallPage.body.meta);
    const vRow = await get(`/api/store/catalog/variants/${P330}`, ck);
    t("e-decimal-string", vRow.status === 200 && /^\d+(\.\d+)?$/.test(vRow.body.data.price) && !vRow.body.data.price.includes("e"),
      String(vRow.body.data?.price));
    const createdAt = bCreate.body.data.createdAt;
    const parsedTs = Date.parse(createdAt);
    t("e-iso-instant", bCreate.status === 201 && Number.isFinite(parsedTs) && /Z|[+-]\d{2}:?\d{2}$/.test(createdAt), String(createdAt));
    await db.query(`CREATE FUNCTION tmp_baac_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'TEST_INJECTED_AUDIT_FAILURE'; END $f$`);
    await db.query(`CREATE TRIGGER tmp_baac_audit_fail_trg BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION tmp_baac_audit_fail()`);
    try {
      const bomb = await post(`/api/admin/catalog/brands`, { name: `BAAC Bomb ${stamp}` }, ck);
      t("e-safe-500", bomb.status === 500 && bomb.body.error?.message === "Unexpected error." && noSecrets(bomb.body),
        String(bomb.status));
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS tmp_baac_audit_fail_trg ON audit_logs`).catch(() => {});
      await db.query(`DROP FUNCTION IF EXISTS tmp_baac_audit_fail()`).catch(() => {});
    }
    t("e-bomb-removed", (await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tmp_baac_audit_fail_trg'`))[0].n === 0);

    // ---------- P: phone ladder ----------
    const variants = ["01096000131", "+201096000131", "00201096000131", "201096000131"];
    const ids = [];
    for (const v of variants) {
      const r = await post(`/api/store/customers/identify`, { phone: v, firstName: "Baac" });
      ids.push(r.body.data?.id);
    }
    t("p-ladder-converges", ids.every((id) => id === ids[0] && typeof id === "string"), JSON.stringify(ids));
    const idCu = ids[0];
    let pInvalidOk = true;
    for (const [bad, want] of [["0141234567", 422], ["abc", 422], ["123", 422], ["", 400]]) {
      const r = await post(`/api/store/customers/identify`, { phone: bad, firstName: "Baac" });
      if (r.status !== want) { pInvalidOk = false; t("p-invalid-rejected", false, `${bad} -> ${r.status}, want ${want}`); break; }
    }
    if (pInvalidOk) t("p-invalid-rejected", true);
    const [pA, pB, pC] = await Promise.all([0, 1, 2].map(() =>
      post(`/api/store/customers/identify`, { phone: "+201096000131", firstName: "Baac" })));
    t("p-concurrent-single", pA.body.data?.id === idCu && pB.body.data?.id === idCu && pC.body.data?.id === idCu);
    const idAddr = (await post(`/api/admin/customers/${idCu}/addresses`, { city: "Matai", phone: "0223456789" }, ck)).body.data.id;

    // ---------- G: guest token lifecycle ----------
    const g0 = await post(`/api/store/cart`, {});
    const tokA = g0.body.data?.guestToken;
    cartIds.add(g0.body.data?.cart?.id);
    t("g-mint-shape", g0.status === 201 && /^[0-9a-f]{64}$/.test(tokA || ""), String(g0.status));
    const gBad = await get(`/api/store/cart`, null, { "x-guest-token": "not-a-token" });
    t("g-invalid-400", gBad.status === 400, String(gBad.status));
    const gUnknown = await get(`/api/store/cart`, null, { "x-guest-token": "ab".repeat(32) });
    t("g-unknown-404", gUnknown.status === 404, String(gUnknown.status));
    const gB = await post(`/api/store/cart`, {});
    const tokB = gB.body.data?.guestToken;
    cartIds.add(gB.body.data?.cart?.id);
    await fetch(`${baseUrl}/api/store/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guest-token": tokB },
      body: JSON.stringify({ productVariantId: P330, quantity: "1" }),
    });
    const cross = await fetch(`${baseUrl}/api/store/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guest-token": tokA },
      body: JSON.stringify({ productVariantId: P330, quantity: "1" }),
    });
    const crossBody = await cross.json().catch(() => ({}));
    const bCart = await get(`/api/store/cart`, null, { "x-guest-token": tokB });
    const bLines = bCart.body.data?.cart?.items ?? bCart.body.data?.items ?? [];
    t("g-ownership", cross.status === 200 && JSON.stringify(bCart.body).includes(P330) && crossBody.data?.cart?.id !== bCart.body.data?.cart?.id,
      `${cross.status}`);
    const gMerge = await post(`/api/store/cart/merge`, { customerId: idCu }, null, { "x-guest-token": tokA });
    t("g-merge-200", gMerge.status === 200 && typeof gMerge.body.data?.merge?.mode === "string", String(gMerge.status));
    // Expired token: backdate the guest cart, then every mutation path rejects safely.
    const expCart = await post(`/api/store/cart`, {});
    const tokE = expCart.body.data?.guestToken;
    const idE = expCart.body.data?.cart?.id;
    cartIds.add(idE);
    await db.query(`UPDATE carts SET expires_at = now() - interval '1 day' WHERE id = $1::uuid`, [idE]);
    const eGet = await get(`/api/store/cart`, null, { "x-guest-token": tokE });
    const eAdd = await fetch(`${baseUrl}/api/store/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-guest-token": tokE },
      body: JSON.stringify({ productVariantId: P330, quantity: "1" }),
    });
    const eMerge = await post(`/api/store/cart/merge`, { customerId: idCu }, null, { "x-guest-token": tokE });
    t("g-expired-rejected", eGet.status === 404 && eAdd.status === 404 && eMerge.status === 409,
      `${eGet.status}/${eAdd.status}/${eMerge.status}`);

    // ---------- I: Idempotency-Key header contract ----------
    const mkGuestCart = async (lines) => {
      const g = await post(`/api/store/cart`, {});
      cartIds.add(g.body.data.cart.id);
      const tok = g.body.data.guestToken;
      for (const [vid, qty] of lines) {
        await fetch(`${baseUrl}/api/store/cart/items`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-guest-token": tok },
          body: JSON.stringify({ productVariantId: vid, quantity: qty }),
        });
      }
      return tok;
    };
    const orderPost = async (tok, body, keyHeader = null) => {
      const r = await fetch(`${baseUrl}/api/store/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guest-token": tok,
          ...(keyHeader ? { "idempotency-key": keyHeader } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const t1 = await mkGuestCart([[P330, "1"]]);
    const k1 = key("h1");
    const i1 = await orderPost(t1, { customerId: idCu, addressId: idAddr }, k1);
    t("i1-header-only-201", i1.status === 201 && typeof i1.body.data?.order?.id === "string", String(i1.status));
    const idO1 = i1.body.data?.order?.id;
    const i2 = await orderPost(t1, { customerId: idCu, addressId: idAddr }, k1);
    t("i2-replay-200", i2.status === 200 && i2.body.meta?.replay === true && i2.body.data?.order?.id === idO1,
      `${i2.status}`);
    const t3 = await mkGuestCart([[P330, "1"]]);
    const i3 = await orderPost(t3, { customerId: idCu, addressId: idAddr }, k1);
    t("i3-diff-cart-409", i3.status === 409 && i3.body.error?.code === "CONFLICT", String(i3.status));
    const t4 = await mkGuestCart([[P330, "1"]]);
    const k4 = key("h4");
    const [c4a, c4b] = await Promise.all([
      orderPost(t4, { customerId: idCu, addressId: idAddr }, k4),
      orderPost(t4, { customerId: idCu, addressId: idAddr }, k4),
    ]);
    const pair4 = [c4a.status, c4b.status].sort().join(",");
    const oneOrder4 = (await q(`SELECT count(*)::int AS n FROM orders WHERE idempotency_key = $1`, [k4]))[0].n === 1;
    t("i4-concurrent-single", (pair4 === "200,201") && oneOrder4, pair4);
    const t5 = await mkGuestCart([[P330, "1"]]);
    const k5 = key("h5");
    const i5bad = await orderPost(t5, { customerId: idCu, addressId: idAddr, couponCode: "NOPE-DOES-NOT-EXIST" }, k5);
    const i5retry = await orderPost(t5, { customerId: idCu, addressId: idAddr }, k5);
    t("i5-failed-reusable", i5bad.status === 404 && i5retry.status === 201, `${i5bad.status}/${i5retry.status}`);
    const t6 = await mkGuestCart([[P330, "1"]]);
    const i6both = await orderPost(t6, { customerId: idCu, addressId: idAddr, idempotencyKey: key("other") }, key("h6"));
    t("i6-conflict-400", i6both.status === 400, String(i6both.status));
    const i6bad = await orderPost(t6, { customerId: idCu, addressId: idAddr }, "has space");
    t("i6-malformed-400", i6bad.status === 400, String(i6bad.status));
    const i6none = await orderPost(t6, { customerId: idCu, addressId: idAddr });
    t("i6-missing-400", i6none.status === 400, String(i6none.status));
    // Cancel the successful header-flow orders (store actor holds orders.cancel).
    for (const oid of [idO1, i5retry.body.data?.order?.id].filter(Boolean)) {
      await post(`/api/admin/orders/${oid}/cancel`, {}, ck);
    }

    // ---------- T: SQL time boundaries (live coupon windows) ----------
    const prm = await post(`/api/admin/promotions`, {
      name: `BAAC Promo ${stamp}`, type: "PERCENTAGE", scope: "ORDER", discountPercent: "5.00",
    }, ck);
    const idPrm = prm.body.data.id;
    promoIds.add(idPrm);
    const cpFuture = await post(`/api/admin/coupons`, {
      promotionId: idPrm, code: `BAACF${stamp}`.toUpperCase().slice(0, 12),
      startAt: new Date(Date.now() + 3600_000).toISOString(),
    }, ck);
    const idCpF = cpFuture.body.data.id;
    couponIds.add(idCpF);
    const tF = await mkGuestCart([[P330, "1"]]);
    const cF = await orderPost(tF, { customerId: idCu, addressId: idAddr, couponCode: cpFuture.body.data.code }, key("tf"));
    t("t-future-coupon-422", cF.status === 422, String(cF.status));
    const cpPast = await post(`/api/admin/coupons`, {
      promotionId: idPrm, code: `BAACP${stamp}`.toUpperCase().slice(0, 12),
      endAt: new Date(Date.now() - 3600_000).toISOString(),
    }, ck);
    const idCpP = cpPast.body.data.id;
    couponIds.add(idCpP);
    const tP = await mkGuestCart([[P330, "1"]]);
    const cP = await orderPost(tP, { customerId: idCu, addressId: idAddr, couponCode: cpPast.body.data.code }, key("tp"));
    t("t-expired-coupon-422", cP.status === 422, String(cP.status));
    const oTs = await checkoutTs();
    async function checkoutTs() {
      const tt = await mkGuestCart([[P330, "1"]]);
      const oo = await orderPost(tt, { customerId: idCu, addressId: idAddr }, key("ts"));
      await post(`/api/admin/orders/${oo.body.data?.order?.id}/cancel`, {}, ck);
      return oo.body.data?.order?.createdAt;
    }
    t("t-order-iso", Number.isFinite(Date.parse(oTs || "")) && /Z|[+-]\d{2}:?\d{2}$/.test(oTs || ""), String(oTs));

    // ---------- H: health endpoint ----------
    const hGet = await get(`/api/health`);
    t("h-healthy", hGet.status === 200 && hGet.body.data?.status === "ok" && hGet.body.data?.database === "ok"
      && typeof hGet.body.meta === "object" && noSecrets(hGet.body), String(hGet.status));
    const hPost = await fetch(`${baseUrl}/api/health`, { method: "POST" });
    t("h-method", hPost.status !== 200 && noSecrets(await hPost.text()), String(hPost.status));

    // ---------- W: sweeper (manual runner; dry-run default, idempotent) ----------
    const wCart = await post(`/api/store/cart`, {});
    const idW = wCart.body.data?.cart?.id;
    cartIds.add(idW);
    await db.query(`UPDATE carts SET expires_at = now() - interval '2 days' WHERE id = $1::uuid`, [idW]);
    const sweep = (extra = []) => {
      const r = spawnSync("node", ["scripts/maintenance/sweep-expired-carts.mjs", "--db", dbName, ...extra],
        { encoding: "utf8" });
      return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
    };
    const wDry = sweep();
    const wDryJson = JSON.parse(wDry.out || "{}");
    const stillActive = (await q(`SELECT status FROM carts WHERE id = $1::uuid`, [idW]))[0]?.status;
    t("w-dry-run", wDry.code === 0 && wDryJson.dryRun === true && wDryJson.matched >= 1 && stillActive === "ACTIVE",
      wDry.out.slice(0, 120));
    const resBefore = (await q(`SELECT reserved_quantity::text AS r FROM inventory WHERE product_variant_id = $1`, [P330]))[0].r;
    const movBefore = Number((await q(`SELECT count(*)::int AS n FROM inventory_movements`))[0].n);
    const wExec = sweep(["--execute"]);
    const wExecJson = JSON.parse(wExec.out || "{}");
    const flipped = (await q(`SELECT status FROM carts WHERE id = $1::uuid`, [idW]))[0]?.status;
    t("w-execute-flips", wExec.code === 0 && wExecJson.dryRun === false && flipped === "EXPIRED", wExec.out.slice(0, 120));
    const wAgain = sweep(["--execute"]);
    const wAgainJson = JSON.parse(wAgain.out || "{}");
    t("w-idempotent", wAgain.code === 0 && wAgainJson.matched === 0 && wAgainJson.expired === 0, wAgain.out.slice(0, 120));
    const resAfter = (await q(`SELECT reserved_quantity::text AS r FROM inventory WHERE product_variant_id = $1`, [P330]))[0].r;
    const movAfter = Number((await q(`SELECT count(*)::int AS n FROM inventory_movements`))[0].n);
    t("w-no-side-effects", resBefore === resAfter && movBefore === movAfter);
    const wRefuseProd = spawnSync("node", ["scripts/maintenance/sweep-expired-carts.mjs", "--db", "hyper_almoatasem"],
      { encoding: "utf8" });
    t("w-refuses-production", wRefuseProd.status !== 0 && /REFUSED_DB/.test(wRefuseProd.stderr || wRefuseProd.stdout || ""));
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      const ordRows = await db.query(
        `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone = $1`, [CANON(P_BAC)],
      ).catch(() => ({ rows: [] }));
      for (const o of ordRows.rows) {
        const items = await db.query(`SELECT product_variant_id, requested_quantity FROM order_items WHERE order_id = $1`, [o.id]).catch(() => ({ rows: [] }));
        for (const it of items.rows) {
          await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2 WHERE product_variant_id = $1`,
            [it.product_variant_id, it.requested_quantity]).catch(() => {});
        }
        await db.query(`DELETE FROM order_discounts WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM coupon_usages WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_item_replacements WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_status_history WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM order_items WHERE order_id = $1`, [o.id]).catch(() => {});
        await db.query(`DELETE FROM orders WHERE id = $1`, [o.id]).catch(() => {});
      }
      for (const id of couponIds) {
        await db.query(`DELETE FROM coupons WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of promoIds) {
        await db.query(`DELETE FROM promotion_buy_get_rules WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotion_rules WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotion_targets WHERE promotion_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM promotions WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of brandIds) {
        await db.query(`DELETE FROM brands WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of cartIds) {
        await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [id]).catch(() => {});
        await db.query(`DELETE FROM carts WHERE id = $1`, [id]).catch(() => {});
      }
      const cust = await db.query(`SELECT id FROM customers WHERE phone = $1`, [CANON(P_BAC)]).catch(() => ({ rows: [] }));
      for (const r of cust.rows) {
        await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        const cc = await db.query(`SELECT id FROM carts WHERE customer_id = $1`, [r.id]).catch(() => ({ rows: [] }));
        for (const c of cc.rows) {
          await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [c.id]).catch(() => {});
          await db.query(`DELETE FROM carts WHERE id = $1`, [c.id]).catch(() => {});
        }
      }
      await db.query(`DELETE FROM customers WHERE phone = $1`, [CANON(P_BAC)]).catch(() => {});
      for (const email of [STORE_EMAIL, OWNER_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`BAAC_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  done(1);
});
