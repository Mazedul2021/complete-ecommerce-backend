// Exports the bundled storefront catalog to server/src/data/catalog.json so a
// fresh database can be seeded without duplicating the product list by hand.
// Run this after editing storefront/src/data/products.js:
//   npm run seed:export
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const storefrontDir = resolve(here, "../../storefront");
const sourcePath = join(storefrontDir, "src", "data", "products.js");
const targetPath = join(here, "..", "src", "data", "catalog.json");

const { products } = await import(pathToFileURL(sourcePath).href);

const catalog = products.map((product) => ({ ...product }));
writeFileSync(targetPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(`Exported ${catalog.length} products → ${targetPath}`);
