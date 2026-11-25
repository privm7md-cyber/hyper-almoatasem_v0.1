// second-agent-csp-sum.mjs — summarizes csp-probe.json (utf-16 tolerant).
import fs from "node:fs";
const raw = fs.readFileSync("D:/Hyper_Data_Review/Second_Agent_Completion/Run_20261106_210603/Logs/csp-probe.json");
let text = raw.toString("utf8");
if (text.includes("\u0000")) text = raw.toString("utf16le");
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const j = JSON.parse(text);
const byD = {}, byP = {};
for (const v of j.violations) {
  byD[v.report.effectiveDirective] = (byD[v.report.effectiveDirective] || 0) + 1;
  const p = v.page.replace("http://localhost:3223", "");
  byP[p] = (byP[p] || 0) + 1;
}
console.log("count:", j.count, "pageErrors:", JSON.stringify(j.pageErrors));
console.log("by directive:", JSON.stringify(byD));
console.log("by page:", JSON.stringify(byP));
