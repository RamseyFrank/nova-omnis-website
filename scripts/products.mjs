import { readdir, readFile, writeFile, mkdir, lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePattern = /^[a-z0-9][a-z0-9._-]*\.(webp|png|jpg|jpeg|avif)$/;
const fields = new Set(["id", "name", "price", "description", "status", "order", "images"]);
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function validateProduct(product, filename) {
  requireValid(product && typeof product === "object" && !Array.isArray(product), "must be a product object");
  for (const key of Object.keys(product)) requireValid(fields.has(key), `unknown field "${key}"`);
  requireValid(typeof product.id === "string" && slugPattern.test(product.id), "id must be a lowercase hyphenated slug");
  requireValid(filename === `${product.id}.json`, "filename must match the product id");
  requireValid(typeof product.name === "string" && product.name.trim().length > 0, "name is required");
  requireValid(typeof product.description === "string", "description must be text (an empty string is allowed)");
  requireValid(["draft", "published"].includes(product.status), "status must be draft or published");
  requireValid(Number.isSafeInteger(product.order) && product.order >= 0, "order must be a non-negative integer");
  const cents = product.price * 100;
  const validPrice = typeof product.price === "number" && Number.isFinite(product.price)
    && product.price >= 0 && Number.isSafeInteger(Math.round(cents))
    && Math.abs(cents - Math.round(cents)) < 0.000001;
  requireValid(validPrice || (product.status === "draft" && product.price === null),
    "price must be a non-negative USD number with at most two decimals (drafts may use null)");
  if (product.images !== undefined) {
    requireValid(Array.isArray(product.images), "images must be an array of filenames");
    requireValid(product.images.every((name) => typeof name === "string" && imagePattern.test(name)),
      "images must use lowercase filenames inside the product image folder (WebP, PNG, JPG, JPEG, AVIF)");
    requireValid(new Set(product.images).size === product.images.length, "images must not contain duplicates");
  }
}

async function discoverImages(root, product) {
  const relativeDirectory = `assets/images/products/${product.id}`;
  const directory = path.join(root, relativeDirectory);
  let entries = [];
  try {
    requireValid((await lstat(directory)).isDirectory(), "image folder must be a directory, not a symlink");
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const imageEntries = entries.filter((entry) => /\.(webp|png|jpe?g|avif)$/i.test(entry.name));
  for (const entry of imageEntries) {
    requireValid(imagePattern.test(entry.name), `rename image "${entry.name}" to a lowercase filename without spaces`);
  }
  const names = product.images ?? imageEntries.map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  requireValid(product.status !== "published" || names.length > 0, "published products need at least one image");
  for (const name of names) {
    // Exact-name matching also catches case errors on Windows before Linux deployment.
    const entry = entries.find((candidate) => candidate.name === name);
    requireValid(entry?.isFile(), `image "${name}" is missing or is not a regular file`);
    requireValid((await lstat(path.join(directory, name))).size > 0, `image "${name}" is empty`);
  }
  return names.map((name) => `${relativeDirectory}/${name}`);
}

export async function buildCatalog(root = projectRoot) {
  const sourceDirectory = path.join(root, "content/products");
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  const catalog = [];
  const errors = [];
  let drafts = 0;
  for (const entry of entries.filter((item) => item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      requireValid(entry.isFile(), "product source must be a regular file");
      const product = JSON.parse((await readFile(path.join(sourceDirectory, entry.name), "utf8")).replace(/^\uFEFF/, ""));
      validateProduct(product, entry.name);
      const images = await discoverImages(root, product);
      if (product.status === "draft") {
        drafts += 1;
      } else {
        catalog.push({ ...product, images });
      }
    } catch (error) {
      errors.push(`${entry.name}: ${error.message}`);
    }
  }
  requireValid(errors.length === 0, `Catalog validation failed:\n${errors.join("\n")}`);
  catalog.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, "en"));
  return {
    products: catalog.map(({ id, name, price, description, images }) => ({ id, name, price, description, images })),
    drafts,
  };
}

export async function writeCatalog(root = projectRoot) {
  // Validate the entire source before touching the last working catalog.
  const result = await buildCatalog(root);
  const destination = path.join(root, "data/products.json");
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serialize(result.products), { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return result;
}

export async function checkCatalog(root = projectRoot) {
  const result = await buildCatalog(root);
  let current;
  try {
    current = JSON.parse(await readFile(path.join(root, "data/products.json"), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read generated catalog. Run npm run catalog:build. ${error.message}`);
  }
  requireValid(JSON.stringify(current) === JSON.stringify(result.products),
    "Generated catalog is out of date. Run npm run catalog:build and commit data/products.json with the product files.");
  return result;
}

export async function addProduct(options, root = projectRoot) {
  requireValid(typeof options.name === "string" && options.name.trim(), "Provide --name \"Product name\"");
  const id = options.id ?? options.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const product = {
    id,
    name: options.name.trim(),
    price: options.price === undefined ? null : Number(options.price),
    description: "",
    status: "draft",
    order: 100,
  };
  requireValid(options.price === undefined || String(options.price).trim().length > 0, "--price needs a number");
  validateProduct(product, `${id}.json`);
  const directory = path.join(root, "content/products");
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, `${id}.json`), serialize(product), { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Product "${id}" already exists; edit its source file instead.`);
    throw error;
  }
  const imageDirectory = path.join(root, "assets/images/products", id);
  await mkdir(imageDirectory, { recursive: true });
  await writeFile(path.join(imageDirectory, ".gitkeep"), "", { flag: "a" });
  return product;
}

const help = `Product pipeline (Node.js 22+)\n\n  npm run product:add -- --name "Product name" [--price 5.00] [--id product-name]\n  npm run catalog:build   Validate sources and generate the published catalog\n  npm run catalog:check   Validate sources and check that the catalog is current\n\nNew products start as drafts. Add images, edit the product JSON, set status to\n"published", and run catalog:build. See README.md for the full workflow.`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || args.includes("--help")) {
    console.log(help);
    return;
  }
  if (command === "add") {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index].replace(/^--/, "");
      requireValid(args[index].startsWith("--") && ["name", "price", "id"].includes(key), `Unknown option: ${args[index]}`);
      requireValid(args[index + 1] !== undefined && !args[index + 1].startsWith("--"), `Missing value for --${key}`);
      requireValid(!(key in options), `Repeated option: --${key}`);
      options[key] = args[index + 1];
    }
    const product = await addProduct(options);
    console.log(`Created draft: content/products/${product.id}.json\nAdd images to: assets/images/products/${product.id}/\nFill in the product details, set status to "published", then run npm run catalog:build.`);
    return;
  }
  requireValid(["build", "check"].includes(command) && args.length === 0, help);
  const result = await (command === "build" ? writeCatalog() : checkCatalog());
  console.log(`Catalog ${command === "build" ? "built" : "checked"}: ${result.products.length} published, ${result.drafts} draft(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
