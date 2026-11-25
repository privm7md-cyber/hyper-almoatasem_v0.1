// second-agent-restore-bab.mjs — restores mojibake search literals to HEAD values.
import fs from "node:fs";
const p = "D:/Hyper_el-moatasem/scripts/api/t-bab-catalog.mjs";
let src = fs.readFileSync(p, "utf8");
const S = (a) => String.fromCodePoint(...a);
const reps2 = [
  ["ط³ظƒط±", S([1587, 1603, 1585])],
  ["ط£ط±ط²", S([1571, 1585, 1586])],
  ["ط§ظ„ط³ظƒط±", S([1575, 1604, 1587, 1603, 1585])],
  [S([1580, 1576, 1606, 1607]), S([1576, 1610, 1587, 1576, 1610])], // بيسبي
  [S([1580, 1576, 1606, 1577]), S([1576, 1610, 1576, 1587, 1610])], // بببسي placeholder replaced below
];
for (const [bad, good] of reps2) {
  const n = src.split(bad).length - 1;
  console.log("replace", JSON.stringify(bad).slice(0, 30), "->", good, "occ:", n);
  src = src.split(bad).join(good);
}
// brand literal
const brandBad = "ط§ظ„ط±ط§ط¹ظٹ";
const brandGood = S([1575, 1604, 1605, 1585, 1575, 1593, 1610]); // المراعي
console.log("brand occ:", src.split(brandBad).length - 1);
src = src.split(brandBad).join(brandGood);
fs.writeFileSync(p, src, "utf8");
console.log("done");
