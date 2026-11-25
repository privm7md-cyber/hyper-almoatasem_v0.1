// Probe: actual columns of products/product_variants/categories/product_images (Primary, read-only).
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
for (const m of readFileSync(".env", "utf8").matchAll(/^\s*([\w-]+)\s*=\s*"?([^"\r\n]*)"?\s*$/gm)) process.env[m[1]] ??= m[2];
registerHooks({ resolve(s,c,next){
  if(s==='server-only')return next(pathToFileURL(path.resolve('vitest.server-only-stub.cjs')).href,c);
  if(s.startsWith('@/'))return next(pathToFileURL(path.resolve('src',s.slice(2)+'.ts')).href,c);
  return next(s,c);
}});
const { prisma } = await import('@/lib/db');
const seen = new Set();
for (const table of ["products", "product_variants", "categories", "product_images"]) {
  if (seen.has(table)) continue;
  seen.add(table);
  const rows = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`;
  console.log(table + ":", rows.map((r) => r.column_name).join(", "));
}
await prisma.$disconnect();
