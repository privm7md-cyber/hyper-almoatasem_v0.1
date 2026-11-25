// Dump Category, Product, ProductVariant, ProductImage, ProductPriceHistory field lists from schema.prisma (sync, repo).
import fs from "node:fs";
const schema = fs.readFileSync("prisma\\schema.prisma", "utf8");
function model(name) {
  const idx = schema.indexOf(`model ${name} {`);
  if (idx < 0) return null;
  const end = schema.indexOf("\n}", idx);
  return schema.slice(idx, end);
}
const out = {
  Category: model("Category"), Product: model("Product"), ProductVariant: model("ProductVariant"),
  ProductImage: model("ProductImage"), ProductPriceHistory: model("ProductPriceHistory"),
};
fs.writeFileSync("_recovery\\v1-ops\\evidence\\p1b-schema.json", JSON.stringify(out, null, 2));
console.log("wrote p1b-schema.json");
