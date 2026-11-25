// Final login check: scratch admin account vs the 3151 server (read-only HTTP; no writes).
import { readFileSync } from "node:fs";
const creds = readFileSync("D:/Hyper_Data_Review/PHASE_12_PREMIUM_ENGINEERING/P12_06/Run_20261117_0900/backups/scratch-perf-creds.txt", "utf8");
const email = creds.match(/^email:\s*(.+)$/m)[1].trim();
const r = await fetch("http://localhost:3151/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: creds.match(/^password:\s*(.+)$/m)[1].trim() }) });
const json = await r.json();
console.log("scratch login:", JSON.stringify({ status: r.status, ok: json?.data?.id !== undefined || json?.ok === true }));
