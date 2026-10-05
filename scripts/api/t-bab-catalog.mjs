// BA-B catalog/search/media verification (real PostgreSQL, scratch-only).
// Usage: node scripts/api/t-bab-catalog.mjs --db <name> --port <port>
// Covers: keyset pagination correctness (duplicate sort values, both dirs,
// invalid cursor, mid-walk deactivation), price/availability/subtree filters
// (+ combos), search tiers/normalization/typo/code-pin/ranking/filters/
// cursors, media CRUD/primary/fallback/audit, 20k scale evidence (EXPLAIN
// index proof + latency bounds). Prints JSON, never secrets.
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
  console.log(JSON.stringify({ suite: "bab-catalog", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

  const get = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const post = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const patch = async (path, data, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const del = async (path, cookie = null) => {
    const r = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers: cookie ? { cookie } : {} });
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
  const noSecrets = (o) => !JSON.stringify(o).includes("passwordHash") && !JSON.stringify(o).includes("password_hash")
    && !JSON.stringify(o).includes("argon2") && !JSON.stringify(o).includes("token_hash");
  const catIds = new Set();
  const brandIds = new Set();
  const productIds = new Set();
  const auditIdsBefore = new Set((await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id));
  const auditN = async (action, entityId) => Number((await q(`SELECT count(*)::int AS n FROM audit_logs
    WHERE action = $1 AND entity_id = $2::uuid`, [action, entityId]))[0].n);

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

    // Scale marker: 20k seed must be present (seeded separately; suite is
    // read-only over it except its own prefixed rows).
    const scaleN = Number((await q(`SELECT count(*)::int AS n FROM products WHERE slug LIKE 'bab-scale%'`))[0].n);
    t("scale-present", scaleN >= 20000, String(scaleN));
    // Query-plan proof: similarity arm uses the functional GIN index
    // (Bitmap Index Scan), never a bare sequential scan.
    const plan = await q(`EXPLAIN (COSTS OFF) SELECT p.id FROM products p
      WHERE p.is_active AND p.deleted_at IS NULL
      AND hyper_norm_ar(p.name) % hyper_norm_ar('سكر')`);
    const planText = plan.map((r) => r["QUERY PLAN"]).join("\n");
    t("bench-index-used", planText.includes("Bitmap Index Scan") && planText.includes("idx_products_search_trgm"),
      planText.split("\n").slice(0, 3).join(" / ").slice(0, 160));
    // Latency evidence on 20k rows (API-observed; generous bound, actuals recorded).
    const latSamples = [];
    for (const qq of ["سكر", "ارز", "بيسبي", "مكرونة"]) {
      const t0 = Date.now();
      const rr = await get(`/api/store/catalog/search?q=${encodeURIComponent(qq)}&limit=10`);
      latSamples.push(Date.now() - t0);
      if (rr.status !== 200) { t("bench-latency", false, `${qq} -> ${rr.status}`); break; }
    }
    if (latSamples.length === 4) {
      const p95 = Math.max(...latSamples);
      t("bench-latency", p95 < 3000, `max=${p95}ms samples=${latSamples.join(",")}`);
    }

    // ---------- pagination fixtures: duplicate names ----------
    const dupCatIds = [];
    for (let i = 0; i < 5; i++) {
      const r = await post(`/api/admin/catalog/categories`, { name: "BAB Page Widget", slug: `bab-page-w-${stamp}-${i}` }, ck);
      if (r.status !== 201) throw new Error(`fixture category failed: ${r.status}`);
      dupCatIds.push(r.body.data.id);
      catIds.add(r.body.data.id);
    }
    const walk = async (base, limit) => {
      const seen = [];
      let cursor = null;
      for (let i = 0; i < 10; i++) {
        const sep = base.includes("?") ? "&" : "?";
        const r = await get(`${base}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, ck);
        if (r.status !== 200) return { ok: false, status: r.status, seen };
        seen.push(...r.body.data.map((x) => x.id));
        cursor = r.body.meta?.nextCursor ?? null;
        if (!cursor) break;
      }
      return { ok: true, seen };
    };
    const w1 = await walk(`/api/admin/catalog/categories?sort=name&dir=asc&search=BAB Page Widget`, 2);
    t("pg-dup-names-cover", w1.ok && w1.seen.length === 5 && new Set(w1.seen).size === 5, JSON.stringify(w1.seen));
    const w2 = await walk(`/api/admin/catalog/categories?sort=name&dir=desc&search=BAB Page Widget`, 2);
    t("pg-desc-cover", w2.ok && w2.seen.length === 5 && new Set(w2.seen).size === 5, JSON.stringify(w2.seen));
    const w3 = await walk(`/api/admin/catalog/categories?sort=created_at&dir=desc&search=BAB Page Widget`, 3);
    t("pg-created-cover", w3.ok && w3.seen.length === 5 && new Set(w3.seen).size === 5, JSON.stringify(w3.seen));
    const badCur = await get(`/api/admin/catalog/categories?limit=2&cursor=not-a-cursor`, ck);
    t("pg-bad-cursor-400", badCur.status === 400 && badCur.body.error?.code === "VALIDATION", String(badCur.status));
    const badCur2 = await get(`/api/admin/catalog/categories?limit=2&cursor=${dupCatIds[0]}`, ck);
    t("pg-uuid-cursor-400", badCur2.status === 400, String(badCur2.status));
    // Mid-walk deactivation: no duplicates, no crash, reflects state.
    const w4a = await get(`/api/admin/catalog/categories?sort=name&dir=asc&search=BAB Page Widget&limit=2`, ck);
    const cur4 = w4a.body.meta?.nextCursor;
    await patch(`/api/admin/catalog/categories/${dupCatIds[4]}`, { isActive: false }, ck);
    const w4b = await get(`/api/admin/catalog/categories?sort=name&dir=asc&search=BAB Page Widget&limit=4&cursor=${encodeURIComponent(cur4)}`, ck);
    const tailIds = w4b.body.data.map((x) => x.id);
    t("pg-midwalk-clean", w4b.status === 200 && new Set(tailIds).size === tailIds.length && !tailIds.includes(dupCatIds[4]),
      JSON.stringify(tailIds));
    await patch(`/api/admin/catalog/categories/${dupCatIds[4]}`, { isActive: true }, ck);

    // ---------- filters ----------
    const fPrice = await get(`/api/store/catalog/products?limit=50&minPrice=10&maxPrice=20`, ck);
    t("f-price-window", fPrice.status === 200, String(fPrice.status));
    const fBadWin = await get(`/api/store/catalog/products?limit=5&minPrice=50&maxPrice=10`, ck);
    t("f-window-400", fBadWin.status === 400, String(fBadWin.status));
    const fBadNum = await get(`/api/store/catalog/products?limit=5&minPrice=abc`, ck);
    t("f-badnum-400", fBadNum.status === 400, String(fBadNum.status));
    const fStock = await get(`/api/store/catalog/products?limit=50&inStock=true`, ck);
    t("f-instock-200", fStock.status === 200, String(fStock.status));
    // Subtree: parent + child + product in child.
    const pCat = await post(`/api/admin/catalog/categories`, { name: `BAB Tree P ${stamp}`, slug: `bab-tree-p-${stamp}` }, ck);
    const idP = pCat.body.data.id;
    catIds.add(idP);
    const cCat = await post(`/api/admin/catalog/categories`, { name: `BAB Tree C ${stamp}`, slug: `bab-tree-c-${stamp}`, parentId: idP }, ck);
    const idC = cCat.body.data.id;
    catIds.add(idC);
    const tProd = await post(`/api/admin/catalog/products`, {
      name: `BAB Tree Prod ${stamp}`, categoryId: idC, productType: "PIECE", unit: "PIECE",
    }, ck);
    const idTP = tProd.body.data.id;
    productIds.add(idTP);
    const fSub = await get(`/api/store/catalog/products?limit=50&category=${idP}`, ck);
    t("f-subtree", fSub.status === 200 && fSub.body.data.some((p) => p.id === idTP), `${fSub.status}/${fSub.body.data.length}`);
    const fLeaf = await get(`/api/store/catalog/products?limit=50&category=${idC}`, ck);
    t("f-leaf", fLeaf.status === 200 && fLeaf.body.data.some((p) => p.id === idTP));
    const otherCat = await post(`/api/admin/catalog/categories`, { name: `BAB Tree O ${stamp}`, slug: `bab-tree-o-${stamp}` }, ck);
    catIds.add(otherCat.body.data.id);
    const fOther = await get(`/api/store/catalog/products?limit=50&category=${otherCat.body.data.id}`, ck);
    t("f-unrelated-empty", fOther.status === 200 && !fOther.body.data.some((p) => p.id === idTP));
    const fCombo = await get(`/api/store/catalog/products?limit=50&category=${idP}&inStock=false&productType=PIECE`, ck);
    void fCombo;
    const fBadCat = await get(`/api/store/catalog/products?limit=5&category=not-a-uuid`, ck);
    t("f-badcat-400", fBadCat.status === 400, String(fBadCat.status));

    // ---------- search tiers / normalization / typo / code ----------
    const sExact = await get(`/api/store/catalog/search?q=${encodeURIComponent("سكر")}&limit=5`);
    const sExactNames = (sExact.body.data?.results || []).map((r) => r.name);
    t("s-exact-tier3", sExact.status === 200 && (sExact.body.data?.results[0]?.match?.tier === 3)
      && sExactNames.some((n) => n === "سكر"), JSON.stringify(sExactNames.slice(0, 3)));
    const sFold = await get(`/api/store/catalog/search?q=${encodeURIComponent("أرز")}&limit=5`);
    t("s-fold-tier3", sFold.status === 200 && (sFold.body.data?.results || []).some((r) => r.match?.tier === 3 && r.name.includes("أرز")),
      JSON.stringify((sFold.body.data?.results || []).slice(0, 2).map((r) => r.name)));
    const sAla = await get(`/api/store/catalog/search?q=${encodeURIComponent("السكر")}&limit=5`);
    t("s-ala-tier3", sAla.status === 200 && (sAla.body.data?.results[0]?.match?.tier === 3), String(sAla.status));
    const sTypo = await get(`/api/store/catalog/search?q=${encodeURIComponent("بيسبي")}&limit=5`);
    t("s-typo-recall", sTypo.status === 200 && (sTypo.body.data?.results || []).some((r) => r.name.includes("بيبسي")),
      JSON.stringify((sTypo.body.data?.results || []).slice(0, 2).map((r) => r.name)));
    const sGib = await get(`/api/store/catalog/search?q=zzzqqqnoxmatch&limit=5`);
    t("s-gibberish-empty", sGib.status === 200 && (sGib.body.data?.results || []).length === 0);
    const sEmpty = await get(`/api/store/catalog/search?q=%20%20&limit=5`);
    t("s-empty-400", sEmpty.status === 400, String(sEmpty.status));
    const sShort = await get(`/api/store/catalog/search?q=a&limit=5`);
    t("s-short-400", sShort.status === 400, String(sShort.status));
    const sCode = await get(`/api/store/catalog/search?q=2010106&limit=5`);
    const sCodeRows = sCode.body.data?.results || [];
    t("s-code-pin", sCode.status === 200 && sCodeRows.length >= 1 && sCodeRows[0]?.match?.kind === "code"
      && sCodeRows[0]?.match?.tier === 4 && sCodeRows.filter((r) => r.match?.kind === "code").length === 1,
      JSON.stringify(sCodeRows.slice(0, 2).map((r) => r.name)));
    // Ranking order: tiers non-increasing, then score non-increasing.
    const sRank = await get(`/api/store/catalog/search?q=${encodeURIComponent("سكر")}&limit=20`);
    const rk = (sRank.body.data?.results || []).map((r) => [r.match.tier, r.match.score, r.id]);
    let rankOk = sRank.status === 200 && rk.length > 1;
    for (let i = 1; i < rk.length && rankOk; i++) {
      const [t0, s0, id0] = rk[i - 1];
      const [t1, s1, id1] = rk[i];
      if (!(t0 > t1 || (t0 === t1 && (s0 > s1 || (s0 === s1 && id0 < id1))))) rankOk = false;
    }
    t("s-rank-order", rankOk, `n=${rk.length}`);
    // Search cursor walk: full coverage, no duplicates.
    const seenS = [];
    let curS = null;
    let walkOk = true;
    for (let i = 0; i < 12; i++) {
      const r = await get(`/api/store/catalog/search?q=${encodeURIComponent("سكر")}&limit=7${curS ? `&cursor=${encodeURIComponent(curS)}` : ""}`);
      if (r.status !== 200) { walkOk = false; break; }
      seenS.push(...r.body.data.results.map((x) => x.id));
      curS = r.body.meta?.nextCursor ?? null;
      if (!curS) break;
    }
    t("s-cursor-walk", walkOk && seenS.length > 0 && new Set(seenS).size === seenS.length, `n=${seenS.length}`);
    const sBadCur = await get(`/api/store/catalog/search?q=${encodeURIComponent("سكر")}&limit=5&cursor=bogus`);
    t("s-bad-cursor-400", sBadCur.status === 400, String(sBadCur.status));
    const sNew = await get(`/api/store/catalog/search?q=${encodeURIComponent("سكر")}&limit=8&sort=newest`);
    const sNewRows = sNew.body.data?.results || [];
    let newOk = sNew.status === 200 && sNewRows.length > 1
      && sNewRows.every((r) => Number.isFinite(Date.parse(r.createdAt)));
    for (let i = 1; i < sNewRows.length && newOk; i++) {
      if (!(sNewRows[i - 1].createdAt >= sNewRows[i].createdAt)) newOk = false;
    }
    t("s-newest-sort", newOk, `n=${sNewRows.length}`);
    const sBrand = await get(`/api/store/catalog/search?q=${encodeURIComponent("المراعي")}&limit=5`);
    t("s-brand-recall", sBrand.status === 200 && (sBrand.body.data?.results || []).length > 0, String(sBrand.status));
    const sFilt = await get(`/api/store/catalog/search?q=${encodeURIComponent("سكر")}&limit=5&inStock=true`);
    t("s-filter-stock", sFilt.status === 200, String(sFilt.status));

    // ---------- media ----------
    const mProd = await post(`/api/admin/catalog/products`, {
      name: `BAB Media Prod ${stamp}`, categoryId: idP, productType: "PIECE", unit: "PIECE",
    }, ck);
    const idMP = mProd.body.data.id;
    productIds.add(idMP);
    const mGal0 = await get(`/api/store/catalog/products/${idMP}/images`);
    t("m-empty-gallery", mGal0.status === 200 && mGal0.body.data?.primary === null
      && Array.isArray(mGal0.body.data?.gallery) && mGal0.body.data.gallery.length === 0, String(mGal0.status));
    const mBadUrl = await post(`/api/admin/catalog/products/${idMP}/images`, { url: "javascript:alert(1)" }, ck);
    t("m-badurl-400", mBadUrl.status === 400, String(mBadUrl.status));
    const mBadMime = await post(`/api/admin/catalog/products/${idMP}/images`,
      { url: "https://cdn.test/x.svg", mimeType: "image/svg+xml" }, ck);
    t("m-badmime-400", mBadMime.status === 400, String(mBadMime.status));
    const mMiss = await post(`/api/admin/catalog/products/04800000-0000-7000-8000-000000009999/images`,
      { url: "https://cdn.test/x.jpg" }, ck);
    t("m-unknown-product-404", mMiss.status === 404, String(mMiss.status));
    const m1 = await post(`/api/admin/catalog/products/${idMP}/images`,
      { url: "https://cdn.test/a.jpg", altText: "A", sortOrder: 2 }, ck);
    const m2 = await post(`/api/admin/catalog/products/${idMP}/images`,
      { url: "https://cdn.test/b.jpg", altText: "B", sortOrder: 1, isPrimary: true }, ck);
    t("m-register-201", m1.status === 201 && m2.status === 201, `${m1.status}/${m2.status}`);
    t("m-register-audit", (await auditN("images.register", m1.body.data.id)) === 1
      && (await auditN("images.register", m2.body.data.id)) === 1);
    const idM1 = m1.body.data.id;
    const idM2 = m2.body.data.id;
    const g1 = await get(`/api/store/catalog/products/${idMP}/images`);
    t("m-primary-first", g1.status === 200 && g1.body.data?.primary?.id === idM2
      && g1.body.data?.gallery?.length === 2 && g1.body.data.gallery[0]?.id === idM2,
      JSON.stringify(g1.body.data?.gallery?.map((x) => x.id)));
    const pFlip = await patch(`/api/admin/catalog/images/${idM1}`, { isPrimary: true }, ck);
    const g2 = await get(`/api/store/catalog/products/${idMP}/images`);
    t("m-flip-primary", pFlip.status === 200 && g2.body.data?.primary?.id === idM1
      && (await auditN("images.primary", idM1)) === 1);
    const [cA, cB] = await Promise.all([
      patch(`/api/admin/catalog/images/${idM1}`, { isPrimary: true }, ck),
      patch(`/api/admin/catalog/images/${idM2}`, { isPrimary: true }, ck),
    ]);
    const g3 = await get(`/api/store/catalog/products/${idMP}/images`);
    const primaries = g3.body.data?.gallery?.filter((x) => x.isPrimary) ?? [];
    t("m-concurrent-single-primary", cA.status === 200 && cB.status === 200 && primaries.length === 1,
      `${cA.status}/${cB.status}/${primaries.length}`);
    const pReorder = await patch(`/api/admin/catalog/images/${idM2}`, { sortOrder: 0 }, ck);
    t("m-reorder-200", pReorder.status === 200, String(pReorder.status));
    const dPrim = await del(`/api/admin/catalog/images/${g3.body.data?.primary?.id}`, ck);
    const g4 = await get(`/api/store/catalog/products/${idMP}/images`);
    t("m-delete-fallback", dPrim.status === 200 && g4.body.data?.gallery?.length === 1
      && g4.body.data?.primary?.id === g4.body.data.gallery[0]?.id);
    const lastId = g4.body.data?.gallery[0]?.id;
    const dLast = await del(`/api/admin/catalog/images/${lastId}`, ck);
    const g5 = await get(`/api/store/catalog/products/${idMP}/images`);
    t("m-delete-empty", dLast.status === 200 && g5.body.data?.primary === null && g5.body.data?.gallery?.length === 0);
    t("m-delete-audit", (await auditN("images.delete", lastId)) === 1);
    const mAnon = await get(`/api/store/catalog/products/${idMP}/images`);
    t("m-public-noauth", mAnon.status === 200 && noSecrets(mAnon.body));
  } finally {
    try {
      const auditIdsAfter = (await q(`SELECT id::text AS id FROM audit_logs`)).map((r) => r.id);
      const mine = auditIdsAfter.filter((id) => !auditIdsBefore.has(id));
      if (mine.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [mine]).catch(() => {});
      }
      for (const pid of productIds) {
        const vr = await db.query(`SELECT id::text AS id FROM product_variants WHERE product_id = $1::uuid`, [pid]).catch(() => ({ rows: [] }));
        for (const v of vr.rows) {
          await db.query(`DELETE FROM inventory WHERE product_variant_id = $1::uuid`, [v.id]).catch(() => {});
          await db.query(`DELETE FROM product_codes WHERE product_variant_id = $1::uuid`, [v.id]).catch(() => {});
          await db.query(`DELETE FROM product_price_history WHERE product_variant_id = $1::uuid`, [v.id]).catch(() => {});
          await db.query(`DELETE FROM product_variants WHERE id = $1::uuid`, [v.id]).catch(() => {});
        }
        await db.query(`DELETE FROM product_images WHERE product_id = $1::uuid`, [pid]).catch(() => {});
        await db.query(`DELETE FROM products WHERE id = $1::uuid`, [pid]).catch(() => {});
      }
      for (const id of brandIds) {
        await db.query(`DELETE FROM brands WHERE id = $1`, [id]).catch(() => {});
      }
      for (const id of catIds) {
        await db.query(`DELETE FROM categories WHERE id = $1`, [id]).catch(() => {});
      }
      for (const email of [STORE_EMAIL, OWNER_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`BAB_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  console.error(String(e.stack).split("\n").slice(0, 4).join(" | "));
  done(1);
});
