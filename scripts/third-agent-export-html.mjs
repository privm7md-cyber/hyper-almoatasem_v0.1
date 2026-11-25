// third-agent-export-html.mjs — offline JSON->HTML for Third Agent run (no re-measure)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const RUN_DIR = "D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349/Lighthouse";
const npxDir = "C:/Users/MEGA/AppData/Local/npm-cache/_npx";
let lwRoot = null;
for (const d of fs.readdirSync(npxDir)) {
  const cand = path.join(npxDir, d, "node_modules", "lighthouse");
  if (fs.existsSync(cand)) { lwRoot = cand; break; }
}
if (!lwRoot) { console.error("lighthouse not found"); process.exit(1); }
const require2 = createRequire(import.meta.url);
const { ReportGenerator } = require2(path.join(lwRoot, "report", "generator", "report-generator.js"));
let n = 0;
for (const f of fs.readdirSync(RUN_DIR).filter((x) => x.endsWith(".json")).sort()) {
  const resultObj = JSON.parse(fs.readFileSync(path.join(RUN_DIR, f), "utf8"));
  const html = ReportGenerator.generateReport(resultObj, "html");
  const out = path.join(RUN_DIR, f.replace(/\.json$/, "") + ".html");
  fs.writeFileSync(out, html, "utf8");
  n += 1;
  console.log("WROTE", path.basename(out));
}
console.log("TOTAL", n);
