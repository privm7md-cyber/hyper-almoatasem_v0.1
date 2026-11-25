// lh-clues.mjs — extract LCP element + CLS culprits + key audit clues from Lighthouse JSON runs.
// Read-only analysis helper. Usage: node scripts/lh-clues.mjs [file1.json file2.json ...]
// With no args, processes curated files in the closure run dir.
import fs from 'node:fs';
import path from 'node:path';

const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
const curated = [
  'home-mobile-r2.json', 'home-desktop-r2.json',
  'categories-mobile.json', 'categories-desktop.json',
  'cat-mobile.json', 'cat-desktop.json',
  'sub-mobile.json', 'sub-desktop.json',
  'product-mobile.json', 'product-desktop.json',
  'search-mobile.json', 'search-desktop.json',
  'cart-mobile.json', 'cart-desktop.json',
  'checkout-mobile.json', 'checkout-desktop.json',
  'admin-mobile.json', 'admin-desktop.json',
];
const files = process.argv.slice(2).length ? process.argv.slice(2) : curated;

const getNodeLabel = (item) => {
  if (!item) return '';
  if (item.node) {
    const n = item.node;
    const sel = n.selector || n.path || '';
    const snippet = (n.snippet || '').replace(/\s+/g, ' ').slice(0, 110);
    return `${sel} || ${snippet}`;
  }
  return JSON.stringify(item).slice(0, 140);
};

for (const f of files) {
  const p = path.isAbsolute(f) ? f : path.join(dir, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const a = j.audits || {};
  console.log(`\n=== ${path.basename(p)} ===`);
  const num = (k) => a[k] ? `${a[k].displayValue} (score=${a[k].score})` : 'n/a';
  console.log(` formFactor=${j.config?.formFactor} finalUrl=${j.finalUrl}`);
  console.log(` TTFB=${num('server-response-time')} FCP=${num('first-contentful-paint')} LCP=${num('largest-contentful-paint')} SI=${num('speed-index')} TBT=${num('total-blocking-time')} TTI=${num('interactive')} CLS=${num('cumulative-layout-shift')}`);

  // LCP element
  const lcpEl = a['largest-contentful-paint-element'];
  if (lcpEl?.details?.items?.[0]) {
    const d = lcpEl.details.items[0];
    if (d.node) console.log(` LCP-ELEMENT: ${getNodeLabel(d)}`);
    if (d.items?.[0]?.node) console.log(` LCP-SUB: ${getNodeLabel(d.items[0])}`);
    if (d.items?.[0]?.url) console.log(` LCP-URL: ${d.items[0].url}`);
  }

  // CLS shifts (audit id differs by LH version)
  const ls = a['layout-shifts'] || a['layout-shift-elements'];
  if (ls?.details?.items) {
    for (const it of ls.details.items.slice(0, 6)) {
      const sub = (it.subItems?.items || []).map(s =>
        getNodeLabel({ node: s.node }) + ` +score=${s.score ?? ''}`
      ).join(' ;; ');
      console.log(` SHIFT score=${it.score} ${it.node ? getNodeLabel(it) : ''} ${sub ? '-> ' + sub.slice(0, 400) : ''}`);
    }
  }

  // render blocking
  const rb = a['render-blocking-resources'];
  if (rb?.details?.items?.length) {
    for (const it of rb.details.items.slice(0, 8)) console.log(` RENDER-BLOCK: +${Math.round(it.wastedMs)}ms ${it.url?.slice(-90)}`);
  } else { console.log(` RENDER-BLOCK: none`); }

  // unused JS top3 by wastedBytes
  const uj = a['unused-javascript'];
  if (uj?.details?.items) {
    const top = uj.details.items.slice(0, 4).map(i => `${(i.url||'').slice(-64)} wasted=${i.wastedBytes}B`).join(' | ');
    console.log(` UNUSED-JS top: ${top}`);
  }

  // long tasks max
  const lt = a['long-tasks'];
  if (lt?.details?.items?.length) {
    const max = Math.max(...lt.details.items.map(i => i.duration || 0), 0);
    console.log(` LONG-TASKS: count=${lt.details.items.length} maxDur=${Math.round(max)}ms`);
  }

  // fonts blocking -> use-undefined-fa / unused css
  const uw = a['unused-css-rules'];
  if (uw?.details?.items?.length) {
    console.log(` UNUSED-CSS: n=${uw.details.items.length} wastedTotal=${uw.details.overallSavingsBytes}B`);
  }
}
