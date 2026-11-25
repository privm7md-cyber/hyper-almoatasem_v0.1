// third-agent-domain-probe.mjs — robots/sitemap/canonical/OG + image-state
// checks on the local prod-mode server (v2). Read-only; no secret printing.
import fs from "node:fs";
const B = process.env.THIRD_BASE || "http://127.0.0.1:3235";
const OUT = "D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349/Evidence/third-domain-probe.json";
const r = { at: new Date().toISOString(), robots: null, sitemap: null, home: null, product: null, accounts: {} };

// robots.txt
{
  const res = await fetch(B + "/robots.txt");
  const t = await res.text();
  r.robots = { status: res.status, lines: t.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 10) };
}
// sitemap.xml
{
  const res = await fetch(B + "/sitemap.xml");
  const s = await res.text();
  const locs = [...s.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  r.sitemap = { status: res.status, entries: locs.length, first3: locs.slice(0, 3), usesLocalhost: locs.some((x) => x.includes("localhost")), usesHttp: locs.some((x) => x.startsWith("http://")) };
}
// home page metadata
{
  const res = await fetch(B + "/");
  const h = await res.text();
  const canon = h.match(/<link rel="canonical"[^>]*>/);
  const ogurl = h.match(/property="og:url"[^>]*>/);
  r.home = {
    status: res.status,
    canonical: canon ? canon[0] : null,
    ogUrl: ogurl ? ogurl[0] : null,
    title: (h.match(/<title>(.*?)<\/title>/) || [])[1] ?? null,
    mentionsLocalhost: /localhost:3235/.test(h),
    ogImage: (h.match(/property="og:image"[^>]*>/) || [])[0] ?? null,
  };
}
// product page metadata + image/placeholder state
{
  const res = await fetch(B + "/p/01800000-0000-7000-8000-000000000100/romi-cheese");
  const h = await res.text();
  const canon = h.match(/<link rel="canonical"[^>]*>/);
  r.product = {
    status: res.status,
    canonical: canon ? canon[0] : null,
    title: (h.match(/<title>(.*?)<\/title>/) || [])[1] ?? null,
    imgTags: (h.match(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"/g) || []).slice(0, 3),
    placeholderText: (h.includes("بلا صورة") || h.includes("لا توجد صورة")) ? "placeholder-shown" : "none",
  };
}
// admin/login + store shell icons only
for (const p of ["/login", "/register"]) {
  const res = await fetch(B + p);
  r.accounts[p.slice(1)] = { status: res.status };
}
fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
