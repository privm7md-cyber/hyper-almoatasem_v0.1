// lh-run-closure.mjs — Lighthouse runner with the EXACT baseline-closure protocol.
// Usage: node scripts/lh-run-closure.mjs <url> <output.json> <mobile|desktop>
//  - mobile:  LH defaults for form-factor=mobile (matches 2026-11-06 baseline configSettings).
//  - desktop: screen 1350x940 mobile=false + slow-4G throttling
//             (rtt 150, throughput 1638.4 kbps, requestLatency 562.5ms,
//              down 1474.56 kbps, up 675 kbps, CPU x4) — matches cart-desktop.json.
import { spawn } from 'node:child_process';

const [url, outPath, formFactor] = process.argv.slice(2);
if (!url || !outPath || !formFactor) {
  console.error('usage: node scripts/lh-run-closure.mjs <url> <output.json> <mobile|desktop>');
  process.exit(2);
}
const chromeFlags = '--headless --no-sandbox --disable-gpu --hide-scrollbars';
const args = [
  '--yes', 'lighthouse', url,
  `--chrome-flags=${chromeFlags}`,
  '--only-categories=performance,accessibility,best-practices,seo',
  '--output=json',
  `--output-path=${outPath}`,
  `--form-factor=${formFactor}`,
  '--chrome-path=C:/Program Files/Google/Chrome/Application/chrome.exe',
  '--quiet',
];
if (formFactor === 'desktop') {
  args.push(
    '--screenEmulation.mobile=false',
    '--screenEmulation.width=1350',
    '--screenEmulation.height=940',
    '--screenEmulation.deviceScaleFactor=1',
    '--throttling-method=devtools',
    '--throttling.rttMs=150',
    '--throttling.throughputKbps=1638.4',
    '--throttling.requestLatencyMs=562.5',
    '--throttling.downloadThroughputKbps=1474.56',
    '--throttling.uploadThroughputKbps=675',
    '--throttling.cpuSlowdownMultiplier=4',
  );
}
// Node >=24 refuses to spawn .cmd directly (EINVAL). npm's npx is plain JS —
// run it through the node binary directly.
const child = spawn(process.execPath, ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
child.on('exit', (code) => process.exit(code ?? 1));
