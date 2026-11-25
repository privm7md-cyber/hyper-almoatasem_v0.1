// PERFORMANCE CHUNK CENSUS — reads a Next.js build directory and reports the
// real byte weight of the client chunks, split by what is inside them.
//
// Why this exists: Next 16's Turbopack build output no longer prints per-route
// sizes, so the sizes are read from the artefacts themselves.
//
// What it answers (§10 of the brief):
//   - how big is the whole client bundle;
//   - how big is the 3D payload (three.js + R3F) and which chunk holds it;
//   - does any CRUD route pull the 3D payload (it must not);
//   - what do the GSAP and Motion chunks weigh.
//
// Usage: node scripts/perf-chunk-census.mjs <dist-dir> [label]
//   e.g. node scripts/perf-chunk-census.mjs .next-perf after

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const dist = process.argv[2] ?? ".next";
const label = process.argv[3] ?? "current";
const distDir = resolve(dist);
const chunksDir = join(distDir, "static", "chunks");

if (!existsSync(chunksDir)) {
  console.error(`No chunk directory at ${distDir}`);
  process.exit(1);
}

/** Every file under the chunk tree, with its byte size. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = walk(chunksDir);
const sizes = files.map((file) => ({
  file: relative(distDir, file).replace(/\\/g, "/"),
  bytes: statSync(file).size,
}));

sizes.sort((a, b) => b.bytes - a.bytes);

/** Which third-party library a chunk carries, decided by its source text. */
function classify(file) {
  const text = readFileSync(file, "utf8");
  const tags = [];
  if (/WebGLRenderingContext|THREE\.|ShaderMaterial|three\/examples/i.test(text)) tags.push("3d");
  if (/gsap|ScrollTrigger|quickTo/i.test(text)) tags.push("gsap");
  if (/framer-motion|motionValue|LazyMotion|AnimatePresence/i.test(text)) tags.push("motion");
  if (/\bprisma\b/i.test(text)) tags.push("prisma");
  return tags;
}

/**
 * lucide inlines each icon as SVG node data, so the library name may never
 * appear in the output. The shape of the data is the reliable marker — and
 * it is counted per icon, because an icon is normally a small part of a
 * chunk that also carries application code.
 */
function iconCount(file) {
  const text = readFileSync(file, "utf8");
  return (text.match(/name:"[a-z0-9-]{1,24}",size:24,node:\[\[/g) ?? []).length;
}

const rows = sizes.map((row) => ({
  ...row,
  tags: classify(join(distDir, row.file)),
  iconModules: iconCount(join(distDir, row.file)),
}));

const totalBytes = rows.reduce((n, row) => n + row.bytes, 0);
const totalIcons = rows.reduce((n, row) => n + row.iconModules, 0);
const byTag = {};
for (const row of rows) {
  for (const tag of row.tags) {
    byTag[tag] = byTag[tag] ?? { bytes: 0, chunks: 0, files: [] };
    byTag[tag].bytes += row.bytes;
    byTag[tag].chunks += 1;
    byTag[tag].files.push(row.file);
  }
}

const report = {
  label,
  distDir: dist,
  chunkCount: rows.length,
  totalBytes,
  totalKB: Number((totalBytes / 1024).toFixed(1)),
  iconModules: totalIcons,
  byTag: Object.fromEntries(
    Object.entries(byTag).map(([tag, value]) => [
      tag,
      {
        bytes: value.bytes,
        kb: Number((value.bytes / 1024).toFixed(1)),
        chunks: value.chunks,
        files: value.files.sort((a, b) => a.localeCompare(b)),
      },
    ]),
  ),
  largest: rows.slice(0, 25),
};

const outDir = join(ROOT, "docs", "data-sources", "perf");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `chunks-${label}.json`), JSON.stringify(report, null, 2), "utf8");

console.log(`[${label}] ${rows.length} client chunks, ${report.totalKB} kB total, ${totalIcons} icon modules`);
for (const [tag, value] of Object.entries(report.byTag)) {
  console.log(`  ${tag.padEnd(8)} ${String(value.kb).padStart(9)} kB across ${value.chunks} chunk(s)`);
}
console.log("\n  largest chunks:");
for (const row of rows.slice(0, 12)) {
  console.log(
    `    ${row.file.padEnd(46)} ${(row.bytes / 1024).toFixed(1).padStart(9)} kB  ${row.tags.join(",")}`,
  );
}
console.log(`\nreport written: docs/data-sources/perf/chunks-${label}.json`);
