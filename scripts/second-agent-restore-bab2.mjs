// second-agent-restore-bab2.mjs — restores sAla + sBrand literals.
import fs from "node:fs";
const p = "D:/Hyper_el-moatasem/scripts/api/t-bab-catalog.mjs";
let src = fs.readFileSync(p, "utf8");
const S = (a) => String.fromCodePoint(...a);
const reps = [
  ["ط§ظ„سكر", S([1575, 1604, 1587, 1603, 1585])], // السكر
  ["ط§ظ„ظ…ط±ط§ط¹ظٹ", S([1575, 1604, 1605, 1585, 1575, 1593, 1610])], // المراعي
];
for (const [bad, good] of reps) {
  console.log(JSON.stringify(bad), "->", good, "occ:", src.split(bad).length - 1);
  src = src.split(bad).join(good);
}
fs.writeFileSync(p, src, "utf8");
console.log("done");
