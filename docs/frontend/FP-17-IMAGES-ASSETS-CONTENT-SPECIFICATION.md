# FP-17 — Images, Assets & Content Strategy

> Classification: `RESOLVED — EXISTING CONTRACT` (verified baseline) · `ADOPTED — TECHNICAL DEFAULT`
> (fallback/policy) · `OWNER DECISION REQUIRED` (content approvals only).
> Strategy only — no image service, uploads, assets, or domains configured here.

## 1. Verified asset baseline (no CDN/storage/upload invented)

- Product images: external `https` URL **metadata only** (`catalog/media.ts`: url/alt/mime/dims rows;
  no binary, no storage provider, no upload; signed-upload is documented future).
- `next.config.ts`: NO `images` key (verified) — no remote patterns configured; no `next/image` usage
  verified in `src/`.
- No logo/favicon asset, no banners, no policy source material found in repo (FP-10 D16 noted).
- No fallback image asset exists (FP-12 neutral-fallback rule references behavior, not a file).

## 2. Image-source policy

- Render ONLY URLs returned for the correct product/variant; never substitute another product's image.
- Missing/broken → neutral clearly-identifiable fallback (behavior per FP-12; no invented photo, no
  external placeholder URL, no random-product image).
- Fixed aspect slots + reserved space; responsive sizes; no oversized grid assets.
- Malformed/untrusted URLs rejected safely (https-only boundary already enforced server-side).
- Remote domains may be configured ONLY after domain approval with evidence (allowlist decision at
  implementation; none configured now). Public-asset caching vs identity-data rules per FP-14.
- Delivery ≠ authorization: showing an image never implies stock/price/purchase rights.

## 3. Brand, promotional & Arabic content

- Logo/favicon/variants, banners + destinations + mobile variants, promotion text/validity:
  all REQUIRE owner-approved source material (none in repo) — UIs render conditional sections that
  omit cleanly without it (FP-11.1 pattern). No invented promotions/discounts/expiries/delivery
  promises/destinations.
- Arabic-first copy: FP-05 locked strings prevail; numerals/currency/units isolated (`bdi`);
  errors/confirmations mapped per code; delivery/cancel/replacement/privacy/terms text ONLY from
  approved policy — absent policies recorded as content gaps (implementation must not publish
  invented terms).

## 4. Acceptance (DEFINED — NOT EXECUTED)

Source-verified rendering; missing→neutral fallback; correctness per product/variant; RTL/responsive;
banner validity gated on approved source; content provenance recorded; infra gaps (domains, upload,
brand assets) explicit. Initial UI may proceed on fallbacks; production imagery integration is a
scoped dependency, not a silent blocker.

---

*End of FP-17 — specification-only, no implementation.*
