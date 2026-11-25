// summarize-closure-after.mjs — final before/after table for the closure run.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
const pick = (j) => {
  const c = j.categories, a = j.audits;
  return {
    perf: c.performance?.score ?? null,
    a11y: c.accessibility?.score ?? null,
    bp: c['best-practices']?.score ?? null,
    seo: c.seo?.score ?? null,
    fcp: a['first-contentful-paint']?.displayValue,
    lcp: a['largest-contentful-paint']?.displayValue,
    si: a['speed-index']?.displayValue,
    tbt: a['total-blocking-time']?.displayValue,
    tti: a.interactive?.displayValue,
    cls: a['cumulative-layout-shift']?.displayValue,
    clsVal: a['cumulative-layout-shift']?.numericValue,
    lh: j.lighthouseVersion,
    ff: j.configSettings?.formFactor,
    rtt: j.configSettings?.throttling?.rttMs,
    cpu: j.configSettings?.throttling?.cpuSlowdownMultiplier,
  };
};
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter(x=>x.endsWith('.json')).sort();
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const s = pick(j);
    console.log(`${f} | v${s.lh} ${s.ff} rtt${s.rtt} cpu${s.cpu} | perf=${s.perf} a11y=${s.a11y} bp=${s.bp} seo=${s.seo} | FCP=${s.fcp} LCP=${s.lcp} SI=${s.si} TBT=${s.tbt} TTI=${s.tti} CLS=${s.cls}`);
  } catch {
    console.log(`${f} | MISSING/parse-error`);
  }
}
