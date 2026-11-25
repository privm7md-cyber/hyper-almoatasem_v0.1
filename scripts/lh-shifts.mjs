// lh-shifts.mjs — dump full layout-shifts audit items (moved nodes + times) for given files.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['product-desktop.json', 'cart-desktop.json', 'categories-desktop.json', 'home-desktop-r2.json'];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const a = j.audits || {};
  const ls = a['layout-shifts'] || a['layout-shift-elements'];
  console.log(`\n=== ${f} === (id=${ls ? (a['layout-shifts'] ? 'layout-shifts' : 'layout-shift-elements') : 'MISSING'})`);
  if (!ls) continue;
  console.log(JSON.stringify(ls.details?.items ?? [], null, 1).slice(0, 4000));
}
