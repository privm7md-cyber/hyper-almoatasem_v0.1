// second-agent-fix-bab.mjs — fixes s-typo-recall check literal in t-bab-catalog.mjs
import fs from "node:fs";
const p = "D:/Hyper_el-moatasem/scripts/api/t-bab-catalog.mjs";
let src = fs.readFileSync(p, "utf8");
const typo = String.fromCodePoint(1580, 1576, 1606, 1607); // جبنه
const correct = String.fromCodePoint(1580, 1576, 1606, 1577); // جبنة
const want = 'includes("' + typo + '")';
console.log("want occurrences:", src.split(want).length - 1);
src = src.split(want).join('includes("' + correct + '")');
fs.writeFileSync(p, src, "utf8");
const idx = src.indexOf("sTypo");
console.log(JSON.stringify(src.slice(idx, idx + 240)));
