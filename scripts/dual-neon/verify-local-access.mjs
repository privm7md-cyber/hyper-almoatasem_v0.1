import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { hashOwnerPassword, ownerAccess } from "./studio-access.mjs";
import { privateFiles } from "./studio-private-files.mjs";

const runtime = process.argv[2];
if (!runtime) throw new Error("Pass the local PGlite module path");
const { PGlite } = await import(pathToFileURL(resolve(runtime)).href);
const db = new PGlite();
const origin = "https://studio.example.invalid";
const limitKey = randomBytes(32);
const password = randomBytes(25).toString("hex");
const settings = { db, origin, limitKey };
const request = ({ method = "GET", requestOrigin, cookie, body } = {}) => new Request(origin, {
  method, body, headers: {
    ...(requestOrigin ? { origin: requestOrigin } : {}),
    ...(cookie ? { cookie } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
  },
});
const login = (value, requestOrigin = origin) => request({
  method: "POST", requestOrigin, body: JSON.stringify({ password: value }),
});
try {
  await db.exec(readFileSync(new URL("./studio-access.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./studio-private-files.sql", import.meta.url), "utf8"));
  const hash = await hashOwnerPassword(password);
  await db.query("INSERT INTO studio_access.owner (password_hash) VALUES ($1)", [hash]);
  const access = ownerAccess(settings);
  assert.equal(await access.authorize(request()), null);
  assert.equal((await access.login(login(password, "https://other.example.invalid"), "test-client")).status, 403);
  assert.equal((await access.login(login("wrong"), "test-client")).status, 401);
  const owner = await access.login(login(password), "test-client");
  assert.equal(owner.status, 200);
  const setCookie = owner.headers.get("set-cookie");
  for (const required of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) assert.ok(setCookie.includes(required));
  const cookie = setCookie.split(";")[0];
  const restartedAccess = ownerAccess(settings);
  const actor = await restartedAccess.authorize(request({ cookie }));
  assert.equal(actor.role, "OWNER");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("المنتجات");
  sheet.addRow(["الباركود", "السعر"]);
  sheet.addRow(["000123", "14.75"]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const objectStore = new Map();
  const fileOptions = {
    db,
    provider: {
      async putPrivate(key, value) { objectStore.set(key, Buffer.from(value)); },
      async getPrivate(key) { return objectStore.get(key) ?? null; },
    },
    async verifyWorkbook(input) {
      const parsed = new ExcelJS.Workbook();
      await parsed.xlsx.load(input);
      assert.equal(parsed.worksheets.length, 1);
    },
  };
  const files = privateFiles(fileOptions);
  assert.equal(await files.store(null, { bytes, kind: "WORKBOOK_UPLOAD", filename: "منتجات.xlsx" }), null);
  assert.equal(await files.store(actor, { bytes, kind: "BACKUP", filename: "backup.zip" }), null);
  await assert.rejects(files.store(actor, { bytes: Buffer.from("invalid"), kind: "WORKBOOK_UPLOAD", filename: "منتجات.xlsx" }));
  const stored = await files.store(actor, { bytes, kind: "WORKBOOK_UPLOAD", filename: "منتجات.xlsx" });
  const newFileService = privateFiles(fileOptions);
  assert.equal(await files.issueDownload(null, stored.id), null);
  const grant = await newFileService.issueDownload(actor, stored.id);
  assert.equal(await newFileService.download(null, grant.token), null);
  const output = await newFileService.download(actor, grant.token);
  assert.equal(output.headers.get("cache-control"), "private, no-store");
  const downloaded = Buffer.from(await output.arrayBuffer());
  assert.deepEqual(downloaded, bytes);
  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(downloaded);
  assert.equal(roundTrip.worksheets[0].getCell("A2").value, "000123");
  assert.equal(roundTrip.worksheets[0].getCell("B2").value, "14.75");
  assert.equal(await newFileService.download(actor, grant.token), null);
  const expired = await files.issueDownload(actor, stored.id);
  await db.query("UPDATE studio_files.download_grants SET expires_at = now()");
  assert.equal(await files.download(actor, expired.token), null);
  assert.equal(await access.authorize(request({ cookie, method: "POST" })), null);
  assert.equal(await access.authorize(request({ cookie, method: "POST", requestOrigin: "https://other.example.invalid" })), null);
  assert.equal((await access.authorize(request({ cookie, method: "POST", requestOrigin: origin }))).role, "OWNER");
  await db.query("UPDATE studio_access.sessions SET expires_at = now()");
  assert.equal(await access.authorize(request({ cookie })), null);
  const nextCookie = (await access.login(login(password), "test-client")).headers.get("set-cookie").split(";")[0];
  await db.query("UPDATE studio_access.owner SET password_hash = $1", [await hashOwnerPassword(password)]);
  assert.equal(await access.authorize(request({ cookie: nextCookie })), null);
  const logoutCookie = (await access.login(login(password), "test-client")).headers.get("set-cookie").split(";")[0];
  const logout = await access.logout(request({ method: "POST", requestOrigin: origin, cookie: logoutCookie }));
  assert.equal(logout.status, 200);
  assert.equal(await access.authorize(request({ cookie: logoutCookie })), null);
  await db.query("UPDATE studio_access.login_windows SET attempts = 5 WHERE scope <> 'all'");
  assert.equal((await access.login(login(password), "test-client")).status, 429);
  console.log(JSON.stringify({
    environment: "embedded PostgreSQL with synthetic owner",
    scenarios: ["unauthenticated denial", "bad password", "cross-origin login and writes",
      "secure session cookie", "new service instance restores authentication", "expiry", "password rotation",
      "logout revocation", "persistent attempt limit", "private one-time download",
      "expired download", "backup route scope", "Arabic XLSX headers and exact barcode and decimal text"],
  }, null, 2));
} finally {
  await db.close();
}
