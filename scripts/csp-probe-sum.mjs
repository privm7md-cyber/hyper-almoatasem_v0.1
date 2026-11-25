// csp-probe-sum.mjs — summarize the captured CSP probe JSON by directive/page.
import fs from 'node:fs';
const raw = fs.readFileSync('D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Logs/csp-probe.json.txt', 'utf8');
const start = raw.indexOf('{');
const j = JSON.parse(raw.slice(start));
console.log('TOTAL:', j.count, ' pageErrors:', j.pageErrors.length);
const byDir = {}, byPage = {};
for (const v of j.violations) {
  const dir = v.report?.effectiveDirective ?? '?';
  const doc = v.page ?? '?';
  byDir[dir] = (byDir[dir] ?? 0) + 1;
  byPage[doc] = (byPage[doc] ?? 0) + 1;
}
console.log('BY DIRECTIVE:'); for (const [k, n] of Object.entries(byDir).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${n}`);
console.log('BY PAGE:'); for (const [k, n] of Object.entries(byPage).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${n}`);
// one full sample of each directive
const seen = new Set();
for (const v of j.violations) {
  const r = v.report ?? {};
  if (seen.has(r.effectiveDirective)) continue;
  seen.add(r.effectiveDirective);
  console.log(`SAMPLE ${r.effectiveDirective}:`, JSON.stringify({ blocked: r.blockedUri, sample: (r.scriptSample || '').slice(0, 100), sourceFile: r.sourceFile, line: r.lineNumber, disposition: r.disposition }));
}
