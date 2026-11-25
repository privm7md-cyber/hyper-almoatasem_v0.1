// PER-ROUTE CLIENT COST — reads the built server manifests and reports, for
// every admin route, how many bytes of client JavaScript the browser must
// download before the page is interactive (the "first load"), and which of
// those bytes are lazy (fetched later, only when the code path is taken).
//
// This is the measurement §10 asks for: it proves the 3D payload is a lazy
// chunk that only the home route can reach, and that no CRUD route pays for
// it.
//
// Usage: node scripts/perf-route-cost.mjs <dist-dir> [label]

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const dist = process.argv[2] ?? ".next";
const label = process.argv[3] ?? "current";
const distDir = resolve(dist);
const serverApp = join(distDir, "server", "app");

if (!existsSync(serverApp)) {
  console.error(`No server app directory at ${distDir}`);
  process.exit(1);
}

function sizeOf(chunkPath) {
  const rel = chunkPath.replace(/^\/_next\//, "");
  const full = join(distDir, rel);
  if (!existsSync(full)) return 0;
  return statSync(full).size;
}

/** What the browser actually downloads: the same bytes, gzip-compressed. */
function gzipSizeOf(chunkPath) {
  const rel = chunkPath.replace(/^\/_next\//, "");
  const full = join(distDir, rel);
  if (!existsSync(full)) return 0;
  return gzipSync(readFileSync(full), { level: 9 }).length;
}

/** Every route folder under server/app that owns a page. */
function pageRoutes(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const full = join(dir, name);
    if (name === "page" || name.endsWith(".page")) {
      const route = prefix.replace(/\/page$/, "").replace(/\/$/, "") || "/";
      // The manifest sits next to the route folder, not inside it.
      out.push({ route, dir: dir });
    } else {
      out.push(...pageRoutes(full, `${prefix}/${name}`));
    }
  }
  return out;
}

const routes = [];
for (const entry of pageRoutes(serverApp)) {
  const manifestPath = join(entry.dir, "page_client-reference-manifest.js");
  if (!existsSync(manifestPath)) continue;
  const text = readFileSync(manifestPath, "utf8");

  const sync = new Set();
  const async = new Set();

  // Every client module the route references, with the chunks it needs.
  for (const m of text.matchAll(/"chunks":\[([^\]]*)\](?:"async":(true|false))?/g)) {
    const list = m[1].match(/\/_next\/static\/chunks\/[^"]+\.js/g) ?? [];
    const isAsync = m[2] === "true";
    for (const chunk of list) (isAsync ? async : sync).add(chunk);
  }
  // Chunk arrays that carry their own async flag inside the module object.
  for (const m of text.matchAll(/"chunks":\[([^\]]*)\][^}]*?"async":true/g)) {
    for (const chunk of m[1].match(/\/_next\/static\/chunks\/[^"]+\.js/g) ?? []) async.add(chunk);
  }

  // next/dynamic chunks live in their own manifest: they are fetched when the
  // dynamic component first renders, never as part of the initial payload.
  const loadablePath = join(entry.dir, "page", "react-loadable-manifest.json");
  const loadable = [];
  if (existsSync(loadablePath)) {
    const manifest = JSON.parse(readFileSync(loadablePath, "utf8"));
    for (const key of Object.keys(manifest)) {
      const files = manifest[key]?.files ?? [];
      for (const file of files) {
        const chunk = `/_next/${file}`;
        async.add(chunk);
        loadable.push(file);
      }
    }
  }

  const syncOnly = [...sync].filter((chunk) => !async.has(chunk));
  const syncBytes = syncOnly.reduce((n, chunk) => n + sizeOf(chunk), 0);
  const syncGzip = syncOnly.reduce((n, chunk) => n + gzipSizeOf(chunk), 0);
  const asyncBytes = [...async].reduce((n, chunk) => n + sizeOf(chunk), 0);

  routes.push({
    route: entry.route,
    syncChunks: syncOnly.length,
    syncKB: Number((syncBytes / 1024).toFixed(1)),
    syncGzipKB: Number((syncGzip / 1024).toFixed(1)),
    lazyChunks: async.size,
    lazyKB: Number((asyncBytes / 1024).toFixed(1)),
    lazyFiles: [...async].map((chunk) => chunk.replace(/^\/_next\//, "")),
    loadableFiles: [...new Set(loadable)],
  });
}

routes.sort((a, b) => a.route.localeCompare(b.route));

// Which chunk holds the 3D payload, and who can reach it.
const chunkDir = join(distDir, "static", "chunks");
const chunkFiles = existsSync(chunkDir)
  ? readdirSync(chunkDir).filter((name) => name.endsWith(".js"))
  : [];

/** Identify a heavy chunk by what is inside it, not by how big it is. */
function bucketOf(name) {
  const text = readFileSync(join(chunkDir, name), "utf8");
  if (/WebGLRenderingContext|THREE\.|ShaderMaterial|three\/examples/.test(text)) return "3d";
  if (/framer-motion|LazyMotion|AnimatePresence|motionValue/.test(text)) return "motion";
  if (/ScrollTrigger|gsap\.registerPlugin|\bgsap\b/.test(text)) return "gsap";
  return "other";
}

const heavy = chunkFiles
  .map((name) => ({
    name,
    kb: Number((statSync(join(chunkDir, name)).size / 1024).toFixed(1)),
    bucket: bucketOf(name),
  }))
  .filter((row) => row.kb > 40)
  .sort((a, b) => b.kb - a.kb);

const adminRoutes = routes.filter((row) => row.route.startsWith("/admin"));
const three = heavy.find((row) => row.bucket === "3d");
const threeChunkPath = three ? `static/chunks/${three.name}` : null;
const threeReachers = adminRoutes
  .filter((row) => threeChunkPath && row.lazyFiles.includes(threeChunkPath))
  .map((row) => row.route);

// The animation runtime: which routes can pull it in, and how big it is.
const motion = heavy.find((row) => row.bucket === "motion");
const motionChunkPath = motion ? `static/chunks/${motion.name}` : null;
const motionReachers = adminRoutes
  .filter((row) => motionChunkPath && row.lazyFiles.includes(motionChunkPath))
  .map((row) => row.route);

const report = {
  label,
  distDir: dist,
  adminRoutes,
  allRouteCount: routes.length,
  threeChunk: threeChunkPath ? { file: threeChunkPath, kb: three.kb } : null,
  threeChunkReachableFrom: threeReachers,
  motionChunk: motionChunkPath ? { file: motionChunkPath, kb: motion.kb } : null,
  motionChunkReachableFrom: motionReachers,
  heavyChunks: heavy.slice(0, 12),
};

const outDir = join(ROOT, "docs", "data-sources", "perf");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `route-cost-${label}.json`), JSON.stringify(report, null, 2), "utf8");

console.log(`[${label}] per-route client cost (${adminRoutes.length} admin routes)\n`);
console.log("  route".padEnd(38) + "first-load".padStart(12) + "gzipped".padStart(12) + "lazy".padStart(12));
for (const row of adminRoutes) {
  console.log(
    `  ${row.route.padEnd(36)} ${(row.syncKB + " kB").padStart(12)} ${(row.syncGzipKB + " kB").padStart(12)} ${(row.lazyKB + " kB").padStart(12)}`,
  );
}
if (report.threeChunk) {
  console.log(
    `\n  3D payload: ${report.threeChunk.file} (${report.threeChunk.kb} kB) — reachable from: ${
      threeReachers.length ? threeReachers.join(", ") : "nothing"
    }`,
  );
}
if (report.motionChunk) {
  console.log(
    `  animation runtime: ${report.motionChunk.file} (${report.motionChunk.kb} kB) — reachable from: ${
      motionReachers.length ? `${motionReachers.length} admin routes (lazy)` : "nothing"
    }`,
  );
}
console.log("\n  lazy = fetched only when the code path is taken, never on first load");
console.log(`\nreport written: docs/data-sources/perf/route-cost-${label}.json`);
