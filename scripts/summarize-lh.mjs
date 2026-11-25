import fs from 'node:fs';
import path from 'node:path';
const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const cats = j.categories;
  const audits = j.audits;
  const perf = cats.performance?.score;
  const a11y = cats.accessibility?.score;
  const bp = cats['best-practices']?.score;
  const seo = cats.seo?.score;
  const lcp = audits['largest-contentful-paint']?.displayValue;
  const inp = audits['interactive']?.displayValue;
  const cls = audits['cumulative-layout-shift']?.displayValue;
  const ttfb = audits['network-requests']?.details?.items?.[0]?.startTime;
  console.log(`${f} | perf=${perf} a11y=${a11y} bp=${bp} seo=${seo} | LCP=${lcp} INP(Interactive)=${inp} CLS=${cls} | ttfb=${ttfb}`);
}
