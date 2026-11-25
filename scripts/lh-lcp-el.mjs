// lh-lcp-el.mjs — dump LCP element audit + resource-summary for given files.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const a = j.audits || {};
  console.log(`\n=== ${f} === finalUrl=${j.finalUrl}`);
  const le = a['largest-contentful-paint-element'];
  console.log('LCP-ELEM:', JSON.stringify(le?.details?.items ?? null, null, 1).slice(0, 1400));
  const rs = a['resource-summary'];
  console.log('RESOURCE-SUMMARY:', JSON.stringify((rs?.details?.items ?? []).map(i => `${i.resourceType}:${i.transferSize}`)).slice(0, 500));
}
