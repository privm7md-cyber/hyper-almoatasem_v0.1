// V1 Real Data Onboarding — Delivery-zone configuration manifest (read-only, Primary).
// Facts: zones, default fee, settings keys; proposes owner-input template. No zones invented.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const q = (t) => db.query(t);
const out = { generatedAt: new Date().toISOString(), db: "hyper_almoatasem", readOnly: true, sections: {} };

out.sections.current_state = {
  delivery_zones: (await q(`SELECT count(*)::int AS n FROM delivery_zones`)).rows[0].n,
  delivery_zones_all: (await q(`SELECT id::text AS id, name, normalized_name, fee::text AS fee, is_active FROM delivery_zones LIMIT 50`)).rows,
};
out.sections.store_settings_delivery = (await q(`SELECT key, value_text, value_type FROM store_settings WHERE key LIKE 'delivery%' ORDER BY key`)).rows;
out.sections.eligibility_policy_env_default = process.env.DELIVERY_ELIGIBILITY_POLICY ?? "unset → 'allow' (today's behaviour)";
out.sections.eligibility_rules = {
  explanation: "ZONE_MATCHED (active zone matches area>village>city, exact normalized) → ZONE fee; UNCONFIGURED (no zones) → default fee, serviceable; UNMATCHED (zones exist, none matches) → default fee; reject policy → NOT serviceable. Zones created via Admin /admin/delivery-zones (settings.manage+delivery.assign); checkout uses resolveDeliveryQuote.",
};
out.sections.proposed_config_owner_template = {
  note: "DO NOT FILL WITHOUT OWNER APPROVAL. Proposed template only.",
  defaultFee: out.sections.store_settings_delivery.find((s) => s.key === "delivery.default_fee")?.value_text ?? "unset",
  zones: [
    {
      note: "Example shape — every value is a PLACEHOLDER (no real zone/fee invented). city+area/village required for scoped zones.",
      city: "<city>", locality: "<village or area>", field: "village" | "area" | "city", eligible: true, fee: "<amount> EGP",
    },
  ],
  required_data: [
    "Exact store coverage: list of cities + serving areas/villages (normalized Arabic; no fuzzy matching — must match checkout input exactly after normalization).",
    "Per-zone fee (non-negative, ≤2 decimals) and active flag.",
    "Default delivery fee (store_settings.delivery.default_fee) — applies when no zone matches.",
    "Addresses to serve: customer cities/areas to test eligibility after setup.",
    "Decide: DELIVERY_ELIGIBILITY_POLICY ('allow' | 'reject') for UNMATCHED addresses when zones exist (owner decision, documented in ADMIN-OPTIMIZATIONS D-7 style).",
  ],
  safety: "All zone writes are guarded (settings.manage + delivery.assign RBAC), version-compared (409 on concurrent change), audited; created/updated via the Admin pages.",
};
writeFileSync("D:/Hyper_Data_Review/POST_P12_PRIORITY_BACKLOG/V1_OPERATIONS_CLOSURE/Run_20261119_0630/evidence/delivery-zone-manifest.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote evidence/delivery-zone-manifest.json");
await db.end();
