// second-agent-restore-bag.mjs — restores bag-e2e search literal to HEAD value.
import fs from "node:fs";
const p = "D:/Hyper_el-moatasem/scripts/api/t-bag-e2e.mjs";
let src = fs.readFileSync(p, "utf8");
const S = (a) => String.fromCodePoint(...a);
const bad = "ط¨ظٹط¨ط³ظٹ";
const good = S([1576, 1610, 1576, 1587, 1610]); // بببسي -> بببسي
console.log("occ:", src.split(bad).length - 1);
src = src.split(bad).join(good);
fs.writeFileSync(p, src, "utf8");
console.log("done");
