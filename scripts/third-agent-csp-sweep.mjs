// third-agent-csp-sweep.mjs — CSP + hardening header sweep across key pages and
// all three Third-Agent prod-mode servers. Header VALUES are stored in the
// Evidence JSON; the console prints a compact structural summary only.
import fs from "node:fs";

const OUT = "D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349/Evidence/third-csp-sweep.json";
const SERVERS = [
  { port: 3233, note: "trusted (TRUSTED_PROXY=1), build .next-closure-verify (pre-Third-Agent)" },
  { port: 3234, note: "untrusted, build .next-closure-verify (pre-Third-Agent)" },
  { port: 3235, note: "trusted, build .next-third-verify (v2: + CSP streaming cap)" },
];
const PAGES = [
  "/", "/cart", "/checkout", "/categories",
  "/p/01800000-0000-7000-8000-000000000200/pepsi",
  "/p/01800000-0000-7000-8000-000000000100/romi-cheese",
  "/search?q=%D8%AC%D8%A8%D9%86%D8%A9",
  "/admin/login", "/login", "/register",
  "/c/01800000-0000-7000-8000-000000000001/dairy-cheese",
  "/robots.txt", "/sitemap.xml", "/api/health",
];

const summarizePolicy = (v) => {
  if (!v) return null;
  const d = v.split(";").map((s) => s.trim().split(" ")[0]).filter(Boolean);
  return {
    directiveCount: d.length,
    directivesFirst12: d.slice(0, 12),
    hasReportUri: v.includes("report-uri") || v.includes("report-to"),
    hasUnsafeInline: v.includes("'unsafe-inline'"),
    hasUnsafeEval: v.includes("'unsafe-eval'"),
  };
};

const rows = [];
for (const srv of SERVERS) {
  for (const p of PAGES) {
    try {
      const r = await fetch(`http://127.0.0.1:${srv.port}${p}`, { redirect: "manual" });
      const h = r.headers;
      const cspRO = h.get("content-security-policy-report-only");
      const cspEnforce = h.get("content-security-policy");
      rows.push({
        server: srv.port,
        page: p,
        status: r.status,
        cspReportOnly: summarizePolicy(cspRO),
        cspEnforcementPresent: !!cspEnforce, // MUST be false everywhere
        hardening: {
          xContentTypeOptions: h.get("x-content-type-options"),
          referrerPolicy: h.get("referrer-policy"),
          xFrameOptions: h.get("x-frame-options"),
        },
      });
    } catch (e) {
      rows.push({ server: srv.port, page: p, status: "ERR", error: String(e).slice(0, 120) });
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));

// compact console table
let bad = 0;
for (const r of rows) {
  if (r.status === "ERR") { console.log(`${r.server} ${r.page} ERR ${r.error}`); bad++; continue; }
  const ro = r.cspReportOnly;
  const flag = !ro || !ro.hasReportUri || ro.hasUnsafeInline || ro.hasUnsafeEval || r.cspEnforcementPresent;
  if (flag) bad++;
  console.log(`${r.server} ${r.page.padEnd(52)} ${String(r.status).padEnd(4)} RO=${ro ? ro.directiveCount + "dir" + (ro.hasReportUri ? "+report" : "") : "MISSING"}${ro && ro.hasUnsafeInline ? " UNSAFE-INLINE!" : ""}${ro && ro.hasUnsafeEval ? " UNSAFE-EVAL!" : ""}${r.cspEnforcementPresent ? " ENFORCEMENT-PRESENT!" : ""}  XCTO=${r.hardening.xContentTypeOptions} RP=${r.hardening.referrerPolicy ? "yes" : "no"}`);
}
console.log(`TOTAL ${rows.length} rows, flagged ${bad}`);
console.log("WROTE", OUT);
