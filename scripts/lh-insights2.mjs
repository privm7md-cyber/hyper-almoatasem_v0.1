// lh-insights2.mjs — LCP breakdown + cls culprits for baseline/after files (null-safe).
import fs from 'node:fs';
import path from 'node:path';
const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
const dump = (x, n = 1600) => (x && x.details ? JSON.stringify(x.details, null, 1).slice(0, n) : 'null/undefined');
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const a = j.audits || {};
  console.log(`\n===== ${f}`);
  for (const id of ['lcp-breakdown-insight', 'lcp-discovery-insight', 'cls-culprits-insight', 'font-display-insight', 'render-blocking-insight', 'document-latency-insight']) {
    const x = a[id];
    console.log(`-- ${id}: ${x ? x.title : 'MISSING'} | displayValue=${x ? x.displayValue : ''}`);
    console.log(dump(x));
  }
}
