// Dump brands-verify facts (robust encodings) — evidence for the closure report.
import { readFileSync } from "node:fs";
const raw = readFileSync("D:/Hyper_el-moatasem/_recovery/v1-ops/evidence/brands-verify.txt");
const s = (raw.includes(Buffer.from([0xff, 0xfe])) ? raw.toString("utf16le") : raw.toString("utf8")).replace(/^\uFEFF/, "");
const keys = ["brandsTotal", "brandsActive", "brandsDeleted", "duplicateNames", "duplicateSlugs", "productsWithBrand", "productsTotal", "productsActive", "productsDeleted", "auditBrandCreates", "auditBrandAssigns", "createdToday"];
const j = JSON.parse(s.substring(s.indexOf("{"), s.lastIndexOf("}") + 1));
for (const k of keys) console.log(k, "=", JSON.stringify(j[k]));
console.log("newest =", JSON.stringify((j.newest || []).slice(0, 8).map((r) => r.name)));
