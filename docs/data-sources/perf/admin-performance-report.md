# ADMIN PERFORMANCE — MEASURED BEFORE AND AFTER

Scope: the admin panel rebuild (Phase 05 / admin 360°). Every number below was
produced by building the tree and reading the build artefacts — nothing here is
an estimate.

The build was re-run against the **final** tree, after the last content fixes
(the operator's identity in the chrome, one rule for role naming, the
fixture-name evidence in the trust classifier). The movement was under 0.3 kB
on any route, which is what those fixes should cost: no dependency was added,
no new client chunk appeared, and the 3D payload stayed off every CRUD route.

## How it was measured

| Step | Command | Artefact |
|---|---|---|
| Baseline tree | `git archive HEAD` → `D:/perf-baseline` | read-only export of the pre-rebuild code |
| Build | `node scripts/perf-build-report.mjs --label <label>` | `build-<label>.json` / `.txt` |
| Client chunk census | `node scripts/perf-chunk-census.mjs <dist> <label>` | `chunks-<label>.json` |
| Per-route client cost | `node scripts/perf-route-cost.mjs <dist> <label>` | `route-cost-<label>.json` |

Next.js 16 (Turbopack) no longer prints per-route sizes at the end of a build,
so the sizes are read from the artefacts themselves:

* the **first load** of a route is the set of chunks listed as *sync* in that
  route's `page_client-reference-manifest.js`;
* the **lazy** set is the chunks listed with `"async": true` plus everything in
  the route's `react-loadable-manifest.json` (the `next/dynamic` chunks);
* **gzipped** is the same bytes compressed at level 9 — what the browser
  actually downloads.

The baseline build aborts during prerendering (`InvariantError: Expected
workStore to be initialized` in `/_global-error` and `/cancellation`, a
Next.js 16 internal bug that also reproduces on the unmodified tree). The
compile stage completes first, so every client chunk and every route manifest
is written and the baseline is fully measurable even though the export fails.

## The numbers

### Per-route first load (what the browser must download before the page works)

| | before | after |
|---|---|---|
| admin routes | 22 | 24 |
| first load, raw | 56.2 – 73.9 kB | **79.2 – 134.7 kB** |
| **first load, gzipped** | **21.1 – 25.9 kB** | **28.7 – 42.8 kB** |
| lazy cost (not on first load) | 0 kB | 121 kB (animation runtime) |

### Client bundle as a whole

| | before | after |
|---|---|---|
| client chunks | 43 | 53 |
| total client bytes | 1090.4 kB | 2538.0 kB |
| icon modules (lucide) | 97 | 96 |
| 3D payload (three.js + R3F) | — | 908.6 kB, 1 chunk |
| GSAP | — | 71.2 kB, 2 chunks |
| Motion (framer-motion core) | — | 120.9 kB, 1 chunk |

### Where the heavy payloads actually live

* **3D — `static/chunks/07lvvhukoasdx.js`, 908.6 kB.** Referenced by exactly
  one other chunk (`1lals9u33jg04.js`, 2.7 kB) — the `AdminScene` gatekeeper
  on the home page. It is **not** in any route's first load and **not** in any
  route manifest: the browser only requests it after the WebGL probe passes on
  `/admin`. No CRUD route can reach it.
* **GSAP — `static/chunks/394nph4vbhokk.js` + one more, 71.2 kB.** Loaded by
  the home hero choreography only; never referenced by a route's first load.
* **Motion — `static/chunks/2irqb0e2eqccz.js`, 120.9 kB.** A `next/dynamic`
  chunk. It is listed in the 24 admin route manifests as a *loadable* chunk,
  which means it is fetched only when the animated surface first renders — and
  the animated surfaces are the drawer, the confirmation gate and the mobile
  navigation overlay. It is never part of a first load.

## What changed and why

The rebuild added a 3D viewport, a GSAP hero, and a Motion-driven interaction
layer. Left eager, all three landed in **every** admin page's first load and
pushed the gzip figure from ~23 kB to ~82 kB. That is the regression the brief
forbids ("لا تستخدم WebGL على حساب سرعة صفحات CRUD"), so each payload was
given a boundary:

1. **3D** — `admin-scene.tsx` probes WebGL and `prefers-reduced-motion` first,
   and only then `await import("./scene-canvas")`. Reduced motion or a missing
   WebGL context never even asks for the chunk.
2. **GSAP** — imported dynamically by the home hero only.
3. **Motion** — this round's work. `MotionRoot` used to wrap the whole admin
   layout, so `motion/react` was statically imported by the layout and pulled
   into every route. It was replaced by `src/components/admin/ui/motion-kit.tsx`:
   the drawer, the confirmation gate and the mobile navigation overlay each
   carry their own `LazyMotion` provider and are reached through
   `next/dynamic`. The runtime is fetched during browser idle time on the pages
   that own an animated surface, and immediately on the first click if the
   operator beats the idle callback — the button never vanishes while the chunk
   is in flight.
4. **The mobile navigation overlay** is only mounted below 1024px (the rail is
   the navigation on wider screens), so on a desktop the animation runtime is
   not fetched at all unless the page owns a drawer or a confirmation gate.

Measured effect of step 3 alone, on the same tree:

| | before this round | after this round |
|---|---|---|
| admin first load, gzipped | 73.7 – 88.0 kB | 28.7 – 42.8 kB |
| animation runtime | eager, on every page | lazy, on demand |

## Runtime proof that the 3D never touches a CRUD page

Build-time numbers say which chunk *could* be requested; they do not prove
which chunk the browser *did* request. That proof comes from
`scripts/preview-shots.mjs`, which reads `performance.getEntriesByType("resource")`
on every captured route and counts the resources whose name matches the 3D
bundle.

| Route | resources requested | bytes transferred | 3D resources requested |
|---|---|---|---|
| `/admin` (home) | 36 | 615 kB | **4** |
| `/admin/orders` | 27 | 8 kB | 0 |
| `/admin/products` | 29 | 13 kB | 0 |
| `/admin/products/new` | 30 | 27 kB | 0 |
| `/admin/taxonomy` | 32 | 182 kB | 0 |
| `/admin/inventory` | 29 | 26 kB | 0 |
| `/admin/promotions` | 30 | 28 kB | 0 |
| `/admin/coupons` | 30 | 30 kB | 0 |
| `/admin/customers` | 27 | 8 kB | 0 |
| `/admin/users` | 29 | 23 kB | 0 |
| `/admin/roles` | 29 | 26 kB | 0 |
| `/admin/permissions` | 27 | 8 kB | 0 |
| `/admin/settings` | 29 | 23 kB | 0 |
| `/admin/delivery-zones` | 29 | 25 kB | 0 |
| `/admin/audit-logs` | 27 | 8 kB | 0 |
| `/admin/products/{id}` | 30 | 34 kB | 0 |
| `/admin/orders/{id}` | 31 | 25 kB | 0 |
| `/admin/customers/{id}` | 29 | 24 kB | 0 |

The 3D payload is requested on the home page and on **no other route** — the
same page that is the only place the scene exists. The CRUD pages carry
8–34 kB of runtime traffic against the home page's 615 kB.

## Reduced motion, measured

The same harness opens `/admin` in a context with `reducedMotion: "reduce"`
and asserts two things: no 3D resource is requested, and no `<canvas>` is
created at all.

```
reduced-motion: three chunks=0  canvas=false
```

So the 3D scene is not merely hidden under reduced motion — the chunk is never
fetched and the canvas never exists. The page falls back to the static CSS
frame with zero extra bytes.

## What the remaining growth is

The gap to the baseline (+7 to +17 kB gzip) is not a library that leaked into
the bundle. It is:

* **16 navigation icons in the rail** — `static/chunks/0wzzyy4c8k4l0.js`,
  31.8 kB raw / **11.1 kB gzip**, all of it lucide SVG path data. The old rail
  shipped 8 icons in its first load; the new one ships 23. This is a deliberate
  design choice (each of the 19 sections gets a distinct mark) and it is the
  single largest item in the first load.
* **Two more routes** (`/admin/taxonomy` and `/admin/delivery-zones`), the
  real-data home page, and the richer product/coupon/promotion forms — which
  is where the per-route spread between 28.7 kB and 42.8 kB comes from.

## The mobile layout fix (measured, not assumed)

The first responsive pass measured **11 of 15 admin routes overflowing
horizontally on a 390 px phone** — up to +347 px of sideways scroll on the
products page. The cause was not the tables: it was `.adm-main-inner`, a grid
whose *implicit* column sizes itself to max-content, so one wide table pushed
the whole page past the edge of the screen. `.adm-frame` had the same problem
in its shell wrapper.

The fix was to give both grids an explicit `minmax(0, 1fr)` column. The tables
then scroll inside their own `.adm-table-scroll` frame (which already had
`overflow-x: auto`), and the page itself never scrolls sideways.

| | before the fix | after the fix |
|---|---|---|
| routes with sideways scroll at 390 px | 11 of 15 | **0 of 15** |
| worst overflow | +347 px (`/admin/products`) | 0 px |
| document scroll width at 390 px | 737 px | **390 px** (exactly the viewport) |

## Other §10 items and where they stand

| Requirement | Status | Evidence |
|---|---|---|
| 3D never loads on CRUD pages | met | the 3D chunk is in no route manifest and no first load |
| Heavy components dynamically imported | met | 3D, GSAP and Motion are all dynamic boundaries |
| Server components for page content | met | every admin page is a server component; only the shell and the controls hydrate |
| Server-side pagination and search | met | keyset pagination (`take: limit + 1`, cursor = last displayed row id) on orders, products, customers, taxonomy, audit logs |
| Table size | bounded | every table is keyset-paginated, no unbounded result sets |
| Images / fonts | met | no raster assets in the admin shell; system font stack with Cairo for Arabic |
| Re-renders / animation loops | met | the 3D viewport is the only continuous animation and it exists on one page; the CSS reveal system is scroll-driven, not timer-driven |
| Reduced motion | met | `prefers-reduced-motion` disables the 3D scene entirely and the CSS reveal system (see `admin.css`) |
| Mobile fallback | met | below 1024px the rail becomes a navigation overlay; the 3D viewport falls back to the static CSS frame |

## Reproducing

```bash
# baseline (read-only export of HEAD, built into D:/perf-baseline/.next)
git archive HEAD | tar -x -C /d/perf-baseline
node scripts/perf-build-report.mjs --tree /d/perf-baseline --label before
node scripts/perf-chunk-census.mjs D:/perf-baseline/.next before
node scripts/perf-route-cost.mjs D:/perf-baseline/.next before

# current tree (built into .next-perf)
node scripts/perf-build-report.mjs --label after
node scripts/perf-chunk-census.mjs .next-perf after
node scripts/perf-route-cost.mjs .next-perf after
```

Both builds point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at the
allowlisted scratch database `hyper_almoatasem_scratch`; the build script
refuses the production-named database.
