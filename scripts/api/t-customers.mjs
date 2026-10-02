// BA-4 customer API suite (scratch-only, needs built server pointed at DB).
// Usage: node scripts/api/t-customers.mjs --db <name> --port <port>
// Covers: public guest identify (create/lookup/equivalence/validation),
// registered upgrade (policy/hash/409s), email semantics, admin
// list/search/detail/patch, address CRUD + scoping + default switch +
// hard delete, Arabic payloads, and the anon/store/owner/roleless/inactive
// matrix. All rows use the 0109000xxxx test range; fixtures untouched.
// Prints JSON, never passwords, hashes, or tokens.
import crypto from "node:crypto";
import argon2 from "argon2";
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
  console.log(JSON.stringify({ suite: "customers", db: dbName, total: results.length, failures: failures.length, failed: failures.map((f) => f.name), passed: results.filter((r) => r.pass).map((r) => r.name) }, null, 2));
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

const OWNER_EMAIL = "owner@hyper-al-moatasem.local";
const OWNER_PW = "Cat-Test-Owner-Pass-0001!";
const STORE_EMAIL = "store-cat-test@example.com";
const STORE_PW = "Cat-Test-Store-Pass-0002!";
const BARE_EMAIL = "bare-cat-test@example.com";
const BARE_PW = "Cat-Test-Bare-Pass-0003!";

// Dedicated BA-4 test range (valid EG mobiles, no fixture collision).
const P_A = "01090000011";
const P_B = "01090000022";
const P_UP = "01090000033";
const P_PATCH = "01090000044";
const P_AD1 = "01090000055";
const P_AD2 = "01090000066";
const CANON = (p) => "2010" + p.slice(3);
const UNKNOWN = "04800000-0000-7000-8000-000000009999";

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
    const setCookie = r.headers.get("set-cookie") || "";
    const match = setCookie.match(/__Host-admin-session=([^;]+)/);
    return { status: r.status, cookie: match ? `__Host-admin-session=${match[1]}` : null };
  };

  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const custCount = async (phone) =>
    Number((await q(`SELECT count(*)::int AS n FROM customers WHERE phone = $1`, [phone]))[0].n);
  const inactiveId = crypto.randomUUID();
  let idA = null;

  try {
    // ---------- public identify: create + lookup + equivalence ----------
    const c1 = await post(`/api/store/customers/identify`, { phone: P_A, firstName: "ضيف" });
    t("identify-new-201", c1.status === 201 && isUuid(c1.body.data.id) && c1.body.data.phone === CANON(P_A)
      && c1.body.data.isRegistered === false && c1.body.data.email === null);
    idA = c1.body.data.id;
    t("identify-no-hash-leak", c1.status === 201 && !("passwordHash" in c1.body.data) && !("password_hash" in c1.body.data)
      && !JSON.stringify(c1.body).includes("argon2"));
    const c2 = await post(`/api/store/customers/identify`, { phone: `+${CANON(P_A)}`, firstName: "Someone Else" });
    t("identify-existing-200", c2.status === 200 && c2.body.data.id === idA);
    const c3 = await post(`/api/store/customers/identify`, { phone: `00${CANON(P_A)}`, firstName: "X" });
    t("identify-equivalence-200", c3.status === 200 && c3.body.data.id === idA);
    t("identify-single-row", (await custCount(CANON(P_A))) === 1);
    const cB = await post(`/api/store/customers/identify`, { phone: P_B, firstName: "Guest", lastName: "Bee" });
    t("identify-lastname-201", cB.status === 201 && cB.body.data.lastName === "Bee");

    // ---------- identify validation ----------
    const blank = await post(`/api/store/customers/identify`, { phone: "   ", firstName: "M" });
    t("identify-blank-400", blank.status === 400);
    const noName = await post(`/api/store/customers/identify`, { phone: P_A });
    t("identify-missing-name-400", noName.status === 400);
    const extra = await post(`/api/store/customers/identify`, { phone: P_A, firstName: "M", governorate: "Cairo" });
    t("identify-unknown-field-400", extra.status === 400);
    const numPhone = await post(`/api/store/customers/identify`, { phone: 1090000011, firstName: "M" });
    t("identify-no-coerce-400", numPhone.status === 400);
    const badPrefix = await post(`/api/store/customers/identify`, { phone: "01412345678", firstName: "M" });
    t("identify-bad-prefix-422", badPrefix.status === 422 && badPrefix.body.error.code === "BUSINESS_RULE");
    const letters = await post(`/api/store/customers/identify`, { phone: "abc123", firstName: "M" });
    t("identify-letters-422", letters.status === 422);
    const short = await post(`/api/store/customers/identify`, { phone: "12345", firstName: "M" });
    t("identify-short-422", short.status === 422);
    const foreign = await post(`/api/store/customers/identify`, { phone: "+14155552671", firstName: "M" });
    t("identify-foreign-422", foreign.status === 422);

    // ---------- auth matrix (identify is public by guest-flow necessity) ----------
    const owner = await loginAs(OWNER_EMAIL, OWNER_PW);
    t("owner-login-ok", owner.status === 201 && !!owner.cookie);
    const store = await loginAs(STORE_EMAIL, STORE_PW);
    t("store-login-ok", store.status === 201 && !!store.cookie);
    const bare = await loginAs(BARE_EMAIL, BARE_PW);
    t("bare-login-ok", bare.status === 201 && !!bare.cookie);
    const anonList = await get(`/api/admin/customers?limit=5`);
    t("anon-list-401", anonList.status === 401);
    const bareList = await get(`/api/admin/customers?limit=5`, bare.cookie);
    t("bare-list-403", bareList.status === 403);
    const bareAddr = await post(`/api/admin/customers/${idA}/addresses`, { city: "Cairo", phone: P_A }, bare.cookie);
    t("bare-address-403", bareAddr.status === 403);
    const storeList = await get(`/api/admin/customers?limit=5`, store.cookie);
    t("store-list-200", storeList.status === 200 && Array.isArray(storeList.body.data));
    const ownerList = await get(`/api/admin/customers?limit=5`, owner.cookie);
    t("owner-list-200", ownerList.status === 200);
    const inactiveHash = await argon2.hash("Ba4-Test-Off-Pass-0001!", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await db.query(`INSERT INTO users (id, name, email, phone, password_hash, is_active) VALUES ($1,'BA4 Off','off-ba4-test@example.com','201133300041',$2,FALSE)`, [inactiveId, inactiveHash]);
    const inactiveLogin = await loginAs("off-ba4-test@example.com", "anything-0000!");
    t("inactive-login-401", inactiveLogin.status === 401);

    // ---------- admin list/search/filters ----------
    const hasA = await get(`/api/admin/customers?search=${CANON(P_A)}&limit=20`, store.cookie);
    t("admin-search-phone", hasA.status === 200 && hasA.body.data.some((c) => c.id === idA));
    const byName = await get(`/api/admin/customers?search=${encodeURIComponent("ضيف")}&limit=20`, store.cookie);
    t("admin-search-arabic-name", byName.status === 200 && byName.body.data.some((c) => c.id === idA));
    const unreg = await get(`/api/admin/customers?registered=false&limit=50`, store.cookie);
    t("admin-filter-unregistered", unreg.status === 200 && unreg.body.data.every((c) => c.isRegistered === false));
    const paged = await get(`/api/admin/customers?limit=1`, store.cookie);
    t("admin-pagination-cursor", paged.status === 200 && paged.body.data.length === 1 && typeof paged.body.meta.nextCursor === "string");
    const badPage = await get(`/api/admin/customers?limit=500`, store.cookie);
    t("admin-bad-pagination-400", badPage.status === 400);
    const boolBad = await get(`/api/admin/customers?registered=yes&limit=5`, store.cookie);
    t("admin-bool-no-coerce-400", boolBad.status === 400);
    const empty = await get(`/api/admin/customers?search=no-such-customer-zzz&limit=5`, store.cookie);
    t("admin-search-empty-200", empty.status === 200 && empty.body.data.length === 0);

    // ---------- detail ----------
    const detail = await get(`/api/admin/customers/${idA}`, store.cookie);
    t("admin-detail-200", detail.status === 200 && detail.body.data.customer.id === idA && Array.isArray(detail.body.data.addresses));
    const detailMiss = await get(`/api/admin/customers/${UNKNOWN}`, store.cookie);
    t("admin-detail-404", detailMiss.status === 404);
    const detailMal = await get(`/api/admin/customers/not-a-uuid`, store.cookie);
    t("admin-detail-malformed-400", detailMal.status === 400);

    // ---------- patch + email semantics ----------
    const up = await post(`/api/store/customers/identify`, { phone: P_PATCH, firstName: "Patch" });
    const idPatch = up.body.data.id;
    const em = await patch(`/api/admin/customers/${idPatch}`, { email: "  Patch.User@Example.COM " }, store.cookie);
    t("patch-email-normalized", em.status === 200 && em.body.data.email === "patch.user@example.com");
    const dupEm = await patch(`/api/admin/customers/${idA}`, { email: "PATCH.USER@example.com" }, store.cookie);
    t("patch-duplicate-email-409", dupEm.status === 409 && dupEm.body.error.code === "CONFLICT");
    const clrEm = await patch(`/api/admin/customers/${idPatch}`, { email: null }, store.cookie);
    t("patch-clear-email-200", clrEm.status === 200 && clrEm.body.data.email === null);
    const nm = await patch(`/api/admin/customers/${idPatch}`, { firstName: "محدث", lastName: "Test", autoAcceptReplacements: true }, store.cookie);
    t("patch-names-200", nm.status === 200 && nm.body.data.firstName === "محدث" && nm.body.data.autoAcceptReplacements === true);
    const badEm = await patch(`/api/admin/customers/${idPatch}`, { email: "not-an-email" }, store.cookie);
    t("patch-bad-email-400", badEm.status === 400);
    const deact = await patch(`/api/admin/customers/${idPatch}`, { isActive: false }, store.cookie);
    t("patch-deactivate-200", deact.status === 200 && deact.body.data.isActive === false);
    const inactReg = await post(`/api/admin/customers/${idPatch}/register`, { password: "Ba4-Register-Pass-0001!" }, store.cookie);
    t("register-inactive-422", inactReg.status === 422);
    const re = await patch(`/api/admin/customers/${idPatch}`, { isActive: true }, store.cookie);
    t("patch-reactivate-200", re.status === 200 && re.body.data.isActive === true);
    const patchMiss = await patch(`/api/admin/customers/${UNKNOWN}`, { firstName: "Z" }, store.cookie);
    t("patch-unknown-404", patchMiss.status === 404);

    // ---------- registered upgrade ----------
    const rup = await post(`/api/store/customers/identify`, { phone: P_UP, firstName: "Up" });
    const idUp = rup.body.data.id;
    const weak = await post(`/api/admin/customers/${idUp}/register`, { password: "short" }, store.cookie);
    t("register-weak-422", weak.status === 422);
    const regMiss = await post(`/api/admin/customers/${UNKNOWN}/register`, { password: "Ba4-Register-Pass-0001!" }, store.cookie);
    t("register-unknown-404", regMiss.status === 404);
    const reg = await post(`/api/admin/customers/${idUp}/register`, { password: "Ba4-Register-Pass-0001!" }, store.cookie);
    t("register-201-ok", reg.status === 200 && reg.body.data.isRegistered === true
      && !("passwordHash" in reg.body.data) && !JSON.stringify(reg.body).includes("argon2"));
    const hashRow = (await q(`SELECT password_hash AS h, is_registered AS r FROM customers WHERE id = $1`, [idUp]))[0];
    t("register-hash-stored", hashRow.r === true && typeof hashRow.h === "string" && hashRow.h.startsWith("$argon2id$"));
    const regAgain = await post(`/api/admin/customers/${idUp}/register`, { password: "Ba4-Register-Pass-0002!" }, store.cookie);
    t("register-again-409", regAgain.status === 409);
    const regFilter = await get(`/api/admin/customers?registered=true&limit=50`, store.cookie);
    t("admin-filter-registered", regFilter.status === 200 && regFilter.body.data.some((c) => c.id === idUp));

    // ---------- addresses ----------
    const ad1 = await post(`/api/store/customers/identify`, { phone: P_AD1, firstName: "Ad1" });
    const ad2 = await post(`/api/store/customers/identify`, { phone: P_AD2, firstName: "Ad2" });
    const idAd1 = ad1.body.data.id;
    const idAd2 = ad2.body.data.id;
    const a1 = await post(`/api/admin/customers/${idAd1}/addresses`, {
      label: "home", city: "القاهرة", area: "مدينة نصر", street: "شارع عباس العقاد",
      buildingNumber: "12", landmark: "بجوار سيتي سنتر", phone: P_AD1, isDefault: true,
    }, store.cookie);
    t("address-create-201", a1.status === 201 && isUuid(a1.body.data.id) && a1.body.data.isDefault === true
      && a1.body.data.phone === CANON(P_AD1) && a1.body.data.city === "القاهرة");
    const aId1 = a1.body.data.id;
    const a2 = await post(`/api/admin/customers/${idAd1}/addresses`, {
      city: "Giza", phone: "02-23456789",
    }, store.cookie);
    t("address-landline-201", a2.status === 201 && a2.body.data.phone === "0223456789" && a2.body.data.isDefault === false);
    const aId2 = a2.body.data.id;
    const alist = await get(`/api/admin/customers/${idAd1}/addresses`, store.cookie);
    t("address-list-default-first", alist.status === 200 && alist.body.data.length === 2 && alist.body.data[0].isDefault === true);
    const aone = await get(`/api/admin/customers/${idAd1}/addresses/${aId1}`, store.cookie);
    t("address-get-200", aone.status === 200 && aone.body.data.id === aId1);
    const across = await get(`/api/admin/customers/${idAd2}/addresses/${aId1}`, store.cookie);
    t("address-cross-customer-404", across.status === 404);
    const acrossPatch = await patch(`/api/admin/customers/${idAd2}/addresses/${aId1}`, { city: "X" }, store.cookie);
    t("address-cross-patch-404", acrossPatch.status === 404);
    const acrossDel = await del(`/api/admin/customers/${idAd2}/addresses/${aId1}`, store.cookie);
    t("address-cross-delete-404", acrossDel.status === 404);
    const aupd = await patch(`/api/admin/customers/${idAd1}/addresses/${aId2}`, { city: "Dokki", landmark: null }, store.cookie);
    t("address-patch-200", aupd.status === 200 && aupd.body.data.city === "Dokki" && aupd.body.data.landmark === null);
    const aswitch = await patch(`/api/admin/customers/${idAd1}/addresses/${aId2}`, { isDefault: true }, store.cookie);
    const afterSwitch = await get(`/api/admin/customers/${idAd1}/addresses`, store.cookie);
    const defaults = afterSwitch.body.data.filter((a) => a.isDefault === true);
    t("address-default-switch", aswitch.status === 200 && defaults.length === 1 && defaults[0].id === aId2);
    const abadv = await post(`/api/admin/customers/${idAd1}/addresses`, { phone: P_AD1 }, store.cookie);
    t("address-missing-city-400", abadv.status === 400);
    const abadp = await post(`/api/admin/customers/${idAd1}/addresses`, { city: "Cairo", phone: "12" }, store.cookie);
    t("address-bad-phone-422", abadp.status === 422);
    const abadl = await post(`/api/admin/customers/${idAd1}/addresses`, { city: "x".repeat(81), phone: P_AD1 }, store.cookie);
    t("address-long-city-400", abadl.status === 400);
    const agov = await post(`/api/admin/customers/${idAd1}/addresses`, { city: "Cairo", phone: P_AD1, governorate: "Giza" }, store.cookie);
    t("address-no-governorate-400", agov.status === 400);
    const amiss = await post(`/api/admin/customers/${UNKNOWN}/addresses`, { city: "Cairo", phone: P_AD1 }, store.cookie);
    t("address-unknown-customer-404", amiss.status === 404);
    const adel = await del(`/api/admin/customers/${idAd1}/addresses/${aId1}`, store.cookie);
    t("address-delete-200", adel.status === 200 && adel.body.data.deleted === true);
    const adelMiss = await del(`/api/admin/customers/${idAd1}/addresses/${UNKNOWN}`, store.cookie);
    t("address-delete-404", adelMiss.status === 404);
    const afinal = await get(`/api/admin/customers/${idAd1}/addresses`, store.cookie);
    t("address-hard-deleted", afinal.status === 200 && afinal.body.data.every((a) => a.id !== aId1));

    // ---------- owner full pass ----------
    const ownerDetail = await get(`/api/admin/customers/${idA}`, owner.cookie);
    t("owner-detail-200", ownerDetail.status === 200 && ownerDetail.body.data.customer.phone === CANON(P_A));
  } finally {
    // Hygiene: remove BA-4-only rows (addresses → customers → users).
    try {
      const phones = [P_A, P_B, P_UP, P_PATCH, P_AD1, P_AD2].map(CANON);
      for (const ph of phones) {
        const rows = await db.query(`SELECT id FROM customers WHERE phone = $1`, [ph]).catch(() => ({ rows: [] }));
        for (const r of rows.rows) {
          await db.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [r.id]).catch(() => {});
        }
      }
      for (const ph of phones) {
        await db.query(`DELETE FROM customers WHERE phone = $1`, [ph]).catch(() => {});
      }
      await db.query(`DELETE FROM audit_logs WHERE user_id = $1`, [inactiveId]).catch(() => {});
      await db.query(`DELETE FROM admin_sessions WHERE user_id = $1`, [inactiveId]).catch(() => {});
      await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [inactiveId]).catch(() => {});
      await db.query(`DELETE FROM users WHERE id = $1`, [inactiveId]).catch(() => {});
      for (const email of [OWNER_EMAIL, STORE_EMAIL, BARE_EMAIL]) {
        await db.query(`DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => {});
      }
    } catch { /* scratch hygiene best-effort */ }
    await db.end().catch(() => {});
  }
  done();
}

main().catch((e) => {
  console.error(`CUSTOMERS_SUITE_FAILED: ${e.constructor.name}: ${String(e.message).slice(0, 200)}`);
  process.exit(1);
});
